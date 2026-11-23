import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { PlanLimitsService } from '../../../common/plan-limits/plan-limits.service';
import { peruHolidays } from '../../../common/time/peru-holidays';
import { fromDbTime, sortBlocks, toDbTime } from '../../../common/time/time-blocks';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { assertNoFutureAppointments } from '../shop-helpers';
import type {
  CreateExceptionDto,
  CreateHolidayDto,
  CreateLocationDto,
  ExceptionsQueryDto,
  UpdateLocationDto,
} from './locations.dto';
import type { LocationWeek } from './week.schemas';

const locationSelect = {
  id: true,
  name: true,
  address: true,
  reference: true,
  lat: true,
  lng: true,
  phone: true,
  timezone: true,
  isPrimary: true,
} as const;

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
  ) {}

  // ─────────────── Sedes ───────────────
  list(t: TenantContext) {
    return this.prisma.run(tenantDb(t), (tx) =>
      tx.location.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: locationSelect,
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
    );
  }

  /** Más de una sede requiere el feature `multiLocation` del plan (Fase 3) y respeta el límite `locations`. */
  async create(t: TenantContext, dto: CreateLocationDto) {
    await this.plans.assertFeature(t.barbershopId, 'multiLocation');
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.plans.assertCanCreate(tx, t.barbershopId, 'locations');
      const loc = await tx.location.create({
        data: { ...dto, barbershopId: t.barbershopId },
        select: locationSelect,
      });
      await this.audit.record(tx, {
        action: 'shop.location.create',
        barbershopId: t.barbershopId,
        entity: 'location',
        entityId: loc.id,
        diff: dto,
      });
      return loc;
    });
  }

  update(t: TenantContext, id: string, dto: UpdateLocationDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findLocation(tx, t.barbershopId, id);
      return tx.location.update({ where: { id }, data: dto, select: locationSelect });
    });
  }

  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const loc = await findLocation(tx, t.barbershopId, id);
      if (loc.isPrimary)
        throw AppError.conflict(
          'No se puede eliminar la sede principal: marca otra como principal primero',
        );
      await assertNoFutureAppointments(
        tx,
        { barbershopId: t.barbershopId, locationId: id },
        'La sede',
      );
      await tx.staff.updateMany({
        where: { barbershopId: t.barbershopId, locationId: id },
        data: { locationId: null },
      });
      await tx.location.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'shop.location.delete',
        barbershopId: t.barbershopId,
        entity: 'location',
        entityId: id,
      });
    });
  }

  makePrimary(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findLocation(tx, t.barbershopId, id);
      // Primero se desmarca la actual (índice único parcial: solo una principal por barbería).
      await tx.location.updateMany({
        where: { barbershopId: t.barbershopId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.location.update({
        where: { id },
        data: { isPrimary: true },
        select: locationSelect,
      });
    });
  }

  // ─────────────── Horario semanal ───────────────
  getHours(t: TenantContext, locationId: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findLocation(tx, t.barbershopId, locationId);
      return readWeek(tx, t.barbershopId, locationId);
    });
  }

  /** Reemplazo completo de la semana (los días que no vienen quedan cerrados). */
  setHours(t: TenantContext, locationId: string, week: LocationWeek) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findLocation(tx, t.barbershopId, locationId);
      await tx.businessHour.deleteMany({ where: { barbershopId: t.barbershopId, locationId } });
      const rows = week.days.flatMap((d) =>
        d.blocks.map((b) => ({
          barbershopId: t.barbershopId,
          locationId,
          dayOfWeek: d.dayOfWeek,
          opensAt: toDbTime(b.start),
          closesAt: toDbTime(b.end),
        })),
      );
      if (rows.length) await tx.businessHour.createMany({ data: rows });
      await this.audit.record(tx, {
        action: 'shop.hours.update',
        barbershopId: t.barbershopId,
        entity: 'location',
        entityId: locationId,
        diff: week,
      });
      return readWeek(tx, t.barbershopId, locationId);
    });
  }

  // ─────────────── Feriados ───────────────
  listHolidays(t: TenantContext, year?: number) {
    return this.prisma.run(tenantDb(t), (tx) =>
      tx.holiday.findMany({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          ...(year
            ? { date: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } }
            : {}),
        },
        select: { id: true, date: true, name: true, locationId: true, source: true },
        orderBy: { date: 'asc' },
      }),
    );
  }

  addHoliday(t: TenantContext, dto: CreateHolidayDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      if (dto.locationId) await findLocation(tx, t.barbershopId, dto.locationId);
      const date = new Date(`${dto.date}T00:00:00Z`);
      const dup = await tx.holiday.findFirst({
        where: { barbershopId: t.barbershopId, date, locationId: dto.locationId, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw AppError.conflict('Ya hay un feriado registrado ese día');
      return tx.holiday.create({
        data: {
          barbershopId: t.barbershopId,
          date,
          name: dto.name,
          locationId: dto.locationId,
          source: 'manual',
        },
        select: { id: true, date: true, name: true, locationId: true, source: true },
      });
    });
  }

  /** Importa los feriados nacionales de Perú del año. Idempotente: los que ya existen se saltan. */
  importPeru(t: TenantContext, year: number) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const holidays = peruHolidays(year);
      const existing = await tx.holiday.findMany({
        where: {
          barbershopId: t.barbershopId,
          locationId: null,
          deletedAt: null,
          date: { in: holidays.map((h) => new Date(`${h.date}T00:00:00Z`)) },
        },
        select: { date: true },
      });
      const have = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)));
      const toCreate = holidays.filter((h) => !have.has(h.date));
      if (toCreate.length) {
        await tx.holiday.createMany({
          data: toCreate.map((h) => ({
            barbershopId: t.barbershopId,
            date: new Date(`${h.date}T00:00:00Z`),
            name: h.name,
            source: 'pe_national' as const,
          })),
        });
      }
      return { created: toCreate.length, skipped: holidays.length - toCreate.length };
    });
  }

  removeHoliday(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const h = await tx.holiday.findFirst({
        where: { id, barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      if (!h) throw AppError.notFound('Feriado');
      await tx.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  // ─────────────── Excepciones puntuales ───────────────
  listExceptions(t: TenantContext, q: ExceptionsQueryDto) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      (
        await tx.scheduleException.findMany({
          where: {
            barbershopId: t.barbershopId,
            deletedAt: null,
            ...(q.locationId ? { locationId: q.locationId } : {}),
            ...(q.from || q.to
              ? {
                  date: {
                    ...(q.from ? { gte: new Date(q.from) } : {}),
                    ...(q.to ? { lte: new Date(q.to) } : {}),
                  },
                }
              : {}),
          },
          orderBy: { date: 'asc' },
        })
      ).map(toException),
    );
  }

  addException(t: TenantContext, dto: CreateExceptionDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findLocation(tx, t.barbershopId, dto.locationId);
      const date = new Date(`${dto.date}T00:00:00Z`);
      const dup = await tx.scheduleException.findFirst({
        where: { barbershopId: t.barbershopId, locationId: dto.locationId, date, deletedAt: null },
        select: { id: true },
      });
      if (dup)
        throw AppError.conflict('Ya hay una excepción para ese día en esa sede: elimínala primero');
      const row = await tx.scheduleException.create({
        data: {
          barbershopId: t.barbershopId,
          locationId: dto.locationId,
          date,
          isClosed: dto.isClosed,
          opensAt: dto.isClosed ? null : toDbTime(dto.opensAt!),
          closesAt: dto.isClosed ? null : toDbTime(dto.closesAt!),
          reason: dto.reason,
        },
      });
      return toException(row);
    });
  }

  removeException(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const e = await tx.scheduleException.findFirst({
        where: { id, barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      if (!e) throw AppError.notFound('Excepción');
      await tx.scheduleException.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }
}

async function findLocation(tx: Tx, barbershopId: string, id: string) {
  const loc = await tx.location.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: { id: true, isPrimary: true },
  });
  if (!loc) throw AppError.notFound('Sede');
  return loc;
}

async function readWeek(tx: Tx, barbershopId: string, locationId: string) {
  const rows = await tx.businessHour.findMany({
    where: { barbershopId, locationId, deletedAt: null },
    select: { dayOfWeek: true, opensAt: true, closesAt: true },
  });
  return {
    days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      blocks: sortBlocks(
        rows
          .filter((r) => r.dayOfWeek === dayOfWeek)
          .map((r) => ({ start: fromDbTime(r.opensAt), end: fromDbTime(r.closesAt) })),
      ),
    })),
  };
}

function toException(e: {
  id: string;
  locationId: string;
  date: Date;
  isClosed: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  reason: string | null;
}) {
  return {
    id: e.id,
    locationId: e.locationId,
    date: e.date,
    isClosed: e.isClosed,
    opensAt: e.opensAt ? fromDbTime(e.opensAt) : null,
    closesAt: e.closesAt ? fromDbTime(e.closesAt) : null,
    reason: e.reason,
  };
}
