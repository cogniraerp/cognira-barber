import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { PlanLimitsService } from '../../../common/plan-limits/plan-limits.service';
import {
  fromDbTime,
  isContained,
  sortBlocks,
  toDbTime,
  type TimeBlock,
} from '../../../common/time/time-blocks';
import { can, tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { StorageProvider } from '../../../infra/storage/storage.provider';
import { assertOwnFile } from '../own-file';
import {
  ACTIVE_APPOINTMENT,
  assertNoFutureAppointments,
  assertSameSet,
  badRequest,
} from '../shop-helpers';
import type { StaffWeek } from '../locations/week.schemas';
import type {
  CreateStaffDto,
  CreateTimeOffDto,
  StaffQueryDto,
  TimeOffQueryDto,
  UpdateStaffDto,
} from './staff.dto';

const staffSelect = {
  id: true,
  displayName: true,
  bio: true,
  photoUrl: true,
  specialties: true,
  socials: true,
  locationId: true,
  isActive: true,
  sortOrder: true,
  _count: { select: { services: { where: { service: { deletedAt: null } } } } },
  membership: {
    select: {
      id: true,
      role: true,
      status: true,
      inviteEmail: true,
      deletedAt: true,
      user: { select: { email: true } },
    },
  },
} as const satisfies Prisma.StaffSelect;
type StaffRow = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
    private readonly storage: StorageProvider,
  ) {}

  // ─────────────── Perfil ───────────────
  async list(t: TenantContext, q: StaffQueryDto) {
    const rows = await this.prisma.run(tenantDb(t), (tx) =>
      tx.staff.findMany({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          ...(q.includeInactive === 'true' ? {} : { isActive: true }),
        },
        select: staffSelect,
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
    );
    return rows.map(toDto);
  }

  get(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      toDto(await findStaff(tx, t.barbershopId, id)),
    );
  }

  create(t: TenantContext, dto: CreateStaffDto) {
    assertOwnFile(this.storage, t.barbershopId, dto.photoUrl, 'photoUrl');
    return this.prisma.run(tenantDb(t), async (tx) => {
      if (dto.isActive) await this.plans.assertCanCreate(tx, t.barbershopId, 'staff');
      if (dto.locationId) await assertLocation(tx, t.barbershopId, dto.locationId);
      const sortOrder = await tx.staff.count({
        where: { barbershopId: t.barbershopId, deletedAt: null },
      });
      const s = await tx.staff.create({
        data: { ...dto, barbershopId: t.barbershopId, sortOrder },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'shop.staff.create',
        barbershopId: t.barbershopId,
        entity: 'staff',
        entityId: s.id,
        diff: dto,
      });
      return toDto(await findStaff(tx, t.barbershopId, s.id));
    });
  }

  update(t: TenantContext, id: string, dto: UpdateStaffDto) {
    assertOwnFile(this.storage, t.barbershopId, dto.photoUrl, 'photoUrl');
    return this.prisma.run(tenantDb(t), async (tx) => {
      const current = await findStaff(tx, t.barbershopId, id);
      if (dto.locationId) await assertLocation(tx, t.barbershopId, dto.locationId);
      if (dto.isActive === true && !current.isActive)
        await this.plans.assertCanCreate(tx, t.barbershopId, 'staff');
      if (dto.isActive === false && current.isActive)
        await assertNoFutureAppointments(
          tx,
          { barbershopId: t.barbershopId, staffId: id },
          'El barbero',
        );
      const { socials, ...rest } = dto;
      await tx.staff.update({
        where: { id },
        data: {
          ...rest,
          ...(socials ? { socials: { ...readSocials(current.socials), ...socials } } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'shop.staff.update',
        barbershopId: t.barbershopId,
        entity: 'staff',
        entityId: id,
        diff: dto,
      });
      return toDto(await findStaff(tx, t.barbershopId, id));
    });
  }

  /** Soft delete. Se conserva para el historial de citas; su acceso (membership) no se toca. */
  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, id);
      await assertNoFutureAppointments(
        tx,
        { barbershopId: t.barbershopId, staffId: id },
        'El barbero',
      );
      await tx.staffService.deleteMany({ where: { barbershopId: t.barbershopId, staffId: id } });
      await tx.staff.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, membershipId: null },
      });
      await this.audit.record(tx, {
        action: 'shop.staff.delete',
        barbershopId: t.barbershopId,
        entity: 'staff',
        entityId: id,
      });
    });
  }

  async reorder(t: TenantContext, ids: string[]) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      const all = await tx.staff.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      assertSameSet(
        ids,
        all.map((s) => s.id),
      );
      await Promise.all(
        ids.map((id, i) => tx.staff.update({ where: { id }, data: { sortOrder: i } })),
      );
    });
    return this.list(t, { includeInactive: 'true' });
  }

  // ─────────────── Horario del barbero ───────────────
  getHours(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, id);
      return readStaffWeek(tx, t.barbershopId, id);
    });
  }

  setHours(t: TenantContext, id: string, week: StaffWeek) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const staff = await findStaff(tx, t.barbershopId, id);
      if (week.inheritLocationHours) {
        // Los descansos deben caer dentro del horario de la sede.
        const locWeek = await locationBlocks(tx, t.barbershopId, staff.locationId);
        week.days.forEach((d, i) =>
          d.breaks.forEach((b, j) => {
            if (!isContained(b, locWeek.get(d.dayOfWeek) ?? [])) {
              throw badRequest(
                `days.${i}.breaks.${j}`,
                'El descanso debe estar dentro del horario de la sede',
              );
            }
          }),
        );
      }
      await tx.staffHour.deleteMany({ where: { barbershopId: t.barbershopId, staffId: id } });
      const rows = week.days.flatMap((d) => [
        ...(week.inheritLocationHours
          ? []
          : d.blocks.map((b) => row(t.barbershopId, id, d.dayOfWeek, b, 'work' as const))),
        ...d.breaks.map((b) => row(t.barbershopId, id, d.dayOfWeek, b, 'break' as const)),
      ]);
      if (rows.length) await tx.staffHour.createMany({ data: rows });
      await tx.staff.update({ where: { id }, data: { customHours: !week.inheritLocationHours } });
      await this.audit.record(tx, {
        action: 'shop.staff.hours',
        barbershopId: t.barbershopId,
        entity: 'staff',
        entityId: id,
        diff: week,
      });
      return readStaffWeek(tx, t.barbershopId, id);
    });
  }

  // ─────────────── Ausencias, vacaciones y bloqueos ───────────────
  listTimeOff(t: TenantContext, id: string, q: TimeOffQueryDto) {
    this.assertTimeOffAccess(t, id);
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, id);
      return tx.staffTimeOff.findMany({
        where: {
          barbershopId: t.barbershopId,
          staffId: id,
          deletedAt: null,
          ...(q.to ? { startsAt: { lt: new Date(q.to) } } : {}),
          ...(q.from ? { endsAt: { gt: new Date(q.from) } } : {}),
        },
        select: { id: true, startsAt: true, endsAt: true, kind: true, reason: true },
        orderBy: { startsAt: 'asc' },
      });
    });
  }

  /**
   * Un barbero puede bloquear SU propio horario (kind 'block'); vacaciones/ausencias y el
   * horario de otros requieren staff.manage. Si choca con citas activas → 409 con la lista,
   * salvo `ignoreConflicts` (las citas se mantienen y hay que gestionarlas aparte).
   */
  addTimeOff(t: TenantContext, id: string, dto: CreateTimeOffDto) {
    this.assertTimeOffAccess(t, id, dto.kind);
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, id);
      const startsAt = new Date(dto.startsAt);
      const endsAt = new Date(dto.endsAt);
      const conflicts = await tx.appointment.findMany({
        where: {
          barbershopId: t.barbershopId,
          staffId: id,
          deletedAt: null,
          status: ACTIVE_APPOINTMENT,
          blockStartAt: { lt: endsAt },
          blockEndAt: { gt: startsAt },
        },
        select: { id: true, startAt: true },
        orderBy: { startAt: 'asc' },
        take: 20,
      });
      if (conflicts.length && !dto.ignoreConflicts) {
        throw new AppError(
          ErrorCode.CONFLICT,
          HttpStatus.CONFLICT,
          `Hay ${conflicts.length} cita(s) en ese rango`,
          {
            conflicts: conflicts.map((c) => ({
              appointmentId: c.id,
              startAt: c.startAt.toISOString(),
            })),
          },
        );
      }
      const row = await tx.staffTimeOff.create({
        data: {
          barbershopId: t.barbershopId,
          staffId: id,
          startsAt,
          endsAt,
          kind: dto.kind,
          reason: dto.reason,
        },
        select: { id: true, startsAt: true, endsAt: true, kind: true, reason: true },
      });
      await this.audit.record(tx, {
        action: 'shop.staff.time_off.create',
        barbershopId: t.barbershopId,
        entity: 'staff_time_off',
        entityId: row.id,
        diff: { staffId: id, kind: dto.kind, conflicts: conflicts.length },
      });
      return row;
    });
  }

  removeTimeOff(t: TenantContext, id: string, timeOffId: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const row = await tx.staffTimeOff.findFirst({
        where: { id: timeOffId, staffId: id, barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true, kind: true },
      });
      if (!row) throw AppError.notFound('Ausencia');
      this.assertTimeOffAccess(t, id, row.kind);
      await tx.staffTimeOff.update({ where: { id: timeOffId }, data: { deletedAt: new Date() } });
    });
  }

  // ─────────────── Servicios del barbero ───────────────
  listServices(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, id);
      return readStaffServices(tx, t.barbershopId, id);
    });
  }

  setServices(
    t: TenantContext,
    id: string,
    items: Array<{
      serviceId: string;
      priceCentsOverride: number | null;
      durationMinOverride: number | null;
    }>,
  ) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, id);
      const n = await tx.service.count({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          id: { in: items.map((i) => i.serviceId) },
        },
      });
      if (n !== items.length) throw badRequest('items', 'Algún servicio no existe');
      await tx.staffService.deleteMany({ where: { barbershopId: t.barbershopId, staffId: id } });
      if (items.length)
        await tx.staffService.createMany({
          data: items.map((i) => ({ ...i, barbershopId: t.barbershopId, staffId: id })),
        });
      await this.audit.record(tx, {
        action: 'shop.staff.services',
        barbershopId: t.barbershopId,
        entity: 'staff',
        entityId: id,
        diff: { items },
      });
      return readStaffServices(tx, t.barbershopId, id);
    });
  }

  private assertTimeOffAccess(
    t: TenantContext,
    staffId: string,
    kind?: 'vacation' | 'absence' | 'block',
  ): void {
    if (can(t, 'staff.manage')) return;
    const onlyBlock = kind === undefined || kind === 'block';
    // Recepción (gestiona toda la agenda) puede bloquear el horario de cualquier barbero.
    if (onlyBlock && can(t, 'appointments.manage_all')) return;
    const own = t.staffId === staffId && can(t, 'appointments.manage_own');
    if (own && onlyBlock) return;
    throw AppError.forbidden(
      own ? 'Solo puedes crear bloqueos; las vacaciones las registra la administración' : undefined,
    );
  }
}

function row(
  barbershopId: string,
  staffId: string,
  dayOfWeek: number,
  b: TimeBlock,
  kind: 'work' | 'break',
) {
  return {
    barbershopId,
    staffId,
    dayOfWeek,
    startsAt: toDbTime(b.start),
    endsAt: toDbTime(b.end),
    kind,
  };
}

async function findStaff(tx: Tx, barbershopId: string, id: string): Promise<StaffRow> {
  const s = await tx.staff.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: staffSelect,
  });
  if (!s) throw AppError.notFound('Barbero');
  return s;
}

async function assertLocation(tx: Tx, barbershopId: string, id: string) {
  const l = await tx.location.count({ where: { id, barbershopId, deletedAt: null } });
  if (!l) throw badRequest('locationId', 'Sede inexistente');
}

/** Horario de la sede del barbero (o la principal si no tiene). */
async function locationBlocks(
  tx: Tx,
  barbershopId: string,
  locationId: string | null,
): Promise<Map<number, TimeBlock[]>> {
  const loc = locationId
    ? { id: locationId }
    : await tx.location.findFirst({
        where: { barbershopId, isPrimary: true, deletedAt: null },
        select: { id: true },
      });
  const rows = loc
    ? await tx.businessHour.findMany({
        where: { barbershopId, locationId: loc.id, deletedAt: null },
      })
    : [];
  const map = new Map<number, TimeBlock[]>();
  for (const r of rows)
    map.set(r.dayOfWeek, [
      ...(map.get(r.dayOfWeek) ?? []),
      { start: fromDbTime(r.opensAt), end: fromDbTime(r.closesAt) },
    ]);
  return map;
}

async function readStaffWeek(tx: Tx, barbershopId: string, staffId: string) {
  const staff = await tx.staff.findUniqueOrThrow({
    where: { id: staffId },
    select: { customHours: true, locationId: true },
  });
  const rows = await tx.staffHour.findMany({ where: { barbershopId, staffId, deletedAt: null } });
  const loc = staff.customHours ? null : await locationBlocks(tx, barbershopId, staff.locationId);
  const pick = (day: number, kind: 'work' | 'break') =>
    sortBlocks(
      rows
        .filter((r) => r.dayOfWeek === day && r.kind === kind)
        .map((r) => ({ start: fromDbTime(r.startsAt), end: fromDbTime(r.endsAt) })),
    );
  return {
    inheritsLocationHours: !staff.customHours,
    // Si hereda, se muestra el horario EFECTIVO (el de la sede) para que la UI no tenga que combinarlo.
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      blocks: loc ? sortBlocks(loc.get(d) ?? []) : pick(d, 'work'),
      breaks: pick(d, 'break'),
    })),
  };
}

async function readStaffServices(tx: Tx, barbershopId: string, staffId: string) {
  const rows = await tx.staffService.findMany({
    where: { barbershopId, staffId, service: { deletedAt: null } },
    select: {
      serviceId: true,
      priceCentsOverride: true,
      durationMinOverride: true,
      service: { select: { name: true, priceCents: true, durationMin: true, sortOrder: true } },
    },
  });
  return rows
    .sort((a, b) => a.service.sortOrder - b.service.sortOrder)
    .map((r) => ({
      serviceId: r.serviceId,
      name: r.service.name,
      basePriceCents: r.service.priceCents,
      baseDurationMin: r.service.durationMin,
      priceCentsOverride: r.priceCentsOverride,
      durationMinOverride: r.durationMinOverride,
      priceCents: r.priceCentsOverride ?? r.service.priceCents,
      durationMin: r.durationMinOverride ?? r.service.durationMin,
    }));
}

function readSocials(raw: unknown): { instagram: string | null; tiktok: string | null } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    instagram: typeof o.instagram === 'string' ? o.instagram : null,
    tiktok: typeof o.tiktok === 'string' ? o.tiktok : null,
  };
}

function toDto({ _count, membership, socials, ...s }: StaffRow) {
  return {
    ...s,
    socials: readSocials(socials),
    servicesCount: _count.services,
    member:
      membership && !membership.deletedAt
        ? {
            id: membership.id,
            email: membership.user?.email ?? membership.inviteEmail,
            role: membership.role,
            status: membership.status,
          }
        : null,
  };
}
