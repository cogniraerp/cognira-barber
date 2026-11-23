import { onDepositAppointmentClosed } from '../deposits/deposits';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import { can, tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import type { AppointmentStatus } from '../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { utcToLocalDate } from '../availability/engine';
import { readBookingRules } from '../shop/settings.schemas';
import { appointmentSelect, toAppointmentDto } from './appointment-view';
import {
  AppointmentDto,
  AppointmentListDto,
  AvailabilityDto,
  AvailabilityQueryDto,
  ChangeStatusDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  RescheduleDto,
  UpdateNotesDto,
} from './appointments.dto';
import { BookingService, resolveCustomer, TRANSITIONS } from './booking.service';
import { AgendaTimeOffListDto, AgendaTimeOffQueryDto } from '../shop/staff/staff.dto';
import { NotificationsService } from '../notifications/notifications.service';

const asList = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * Agenda de la barbería. Permisos:
 *  - appointments.view_all / manage_all: todas las citas.
 *  - appointments.view_own / manage_own: solo las del barbero vinculado al usuario.
 *  - customers.view_contact: ver teléfono/email del cliente (si no, enmascarados).
 */
@ApiTags('shop · agenda')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop')
export class ShopAppointmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booking: BookingService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Disponibilidad para el panel: sin anticipación mínima y hasta 1 año. */
  @Get('availability')
  @ZodResponse({ type: AvailabilityDto })
  async getAvailability(@CurrentTenant() t: TenantContext, @Query() q: AvailabilityQueryDto) {
    this.assertCanView(t, q.staffId);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const rules = await rulesOf(tx, t.barbershopId);
      const r = await this.availability.compute(tx, {
        barbershopId: t.barbershopId,
        serviceIds: asList(q.serviceIds),
        staffId:
          q.staffId ?? (can(t, 'appointments.view_all') ? undefined : (t.staffId ?? undefined)),
        locationId: q.locationId,
        from: q.from,
        to: q.to,
        slotIntervalMinutes: rules.slotIntervalMinutes,
        minNoticeMinutes: 0,
        maxAdvanceDays: 365,
        onlineOnly: false,
      });
      return groupByDay(r.slots, r.timezone, true, [...r.quotes.values()]);
    });
  }

  @Get('appointments')
  @ZodResponse({ type: AppointmentListDto })
  async list(@CurrentTenant() t: TenantContext, @Query() q: ListAppointmentsQueryDto) {
    const ownOnly = !can(t, 'appointments.view_all');
    if (ownOnly && !can(t, 'appointments.view_own')) throw AppError.forbidden();
    if (ownOnly && !t.staffId) return [];
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to.getTime() - from.getTime() > 62 * 86_400_000)
      throw AppError.conflict('Máximo 62 días por consulta');
    const rows = await this.prisma.run(tenantDb(t), (tx) =>
      tx.appointment.findMany({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          startAt: { lt: to },
          endAt: { gt: from },
          ...(ownOnly ? { staffId: t.staffId! } : q.staffId ? { staffId: q.staffId } : {}),
          ...(q.locationId ? { locationId: q.locationId } : {}),
          ...(q.status ? { status: { in: asList(q.status) } } : {}),
        },
        select: appointmentSelect,
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.map((a) => toAppointmentDto(a, { showContact: can(t, 'customers.view_contact') }));
  }

  /** Ausencias y bloqueos de los barberos visibles, para pintarlos en la agenda. */
  @Get('time-off')
  @ZodResponse({ type: AgendaTimeOffListDto })
  async listTimeOff(@CurrentTenant() t: TenantContext, @Query() q: AgendaTimeOffQueryDto) {
    const ownOnly = !can(t, 'appointments.view_all');
    if (ownOnly && !can(t, 'appointments.view_own')) throw AppError.forbidden();
    if (ownOnly && !t.staffId) return [];
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to.getTime() - from.getTime() > 62 * 86_400_000)
      throw AppError.conflict('Máximo 62 días por consulta');
    return this.prisma.run(tenantDb(t), (tx) =>
      tx.staffTimeOff.findMany({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          startsAt: { lt: to },
          endsAt: { gt: from },
          ...(ownOnly ? { staffId: t.staffId! } : q.staffId ? { staffId: q.staffId } : {}),
        },
        select: { id: true, staffId: true, startsAt: true, endsAt: true, kind: true, reason: true },
        orderBy: { startsAt: 'asc' },
      }),
    );
  }

  @Get('appointments/:id')
  @ZodResponse({ type: AppointmentDto })
  async get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    const a = await this.prisma.run(tenantDb(t), (tx) => load(tx, t.barbershopId, id));
    this.assertCanView(t, a.staff.id);
    return toAppointmentDto(a, { showContact: can(t, 'customers.view_contact') });
  }

  /** Cita creada desde el panel (teléfono, walk-in, manual). */
  @Post('appointments')
  @ZodResponse({ type: AppointmentDto, status: 201 })
  async create(@CurrentTenant() t: TenantContext, @Body() dto: CreateAppointmentDto) {
    this.assertCanManage(t, dto.staffId);
    const { rules, customerId } = await this.prisma.run(tenantDb(t), async (tx) => {
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { country: true },
      });
      let customerId: string | null = null;
      if (dto.customer && 'id' in dto.customer) {
        const c = await tx.customer.findFirst({
          where: { id: dto.customer.id, barbershopId: t.barbershopId, deletedAt: null },
          select: { id: true },
        });
        if (!c) throw AppError.notFound('Cliente');
        customerId = c.id;
      } else if (dto.customer) {
        customerId = (await resolveCustomer(tx, t.barbershopId, dto.customer, shop.country)).id;
      }
      return { rules: await rulesOf(tx, t.barbershopId), customerId };
    });
    // Walk-in sin hora: empieza ya (redondeado al minuto); se asume fuera de grilla → force.
    const startAt = dto.startAt
      ? new Date(dto.startAt)
      : new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const force = dto.force || !dto.startAt;
    const id = await this.bookOrSuggest(t, {
      serviceIds: dto.serviceIds,
      staffId: dto.staffId,
      startAt,
      customerId,
      source: dto.source,
      status: dto.status,
      customerNotes: dto.customerNotes ?? null,
      internalNotes: dto.internalNotes ?? null,
      enforceSchedule: !force,
      rules: {
        slotIntervalMinutes: rules.slotIntervalMinutes,
        minNoticeMinutes: 0,
        maxAdvanceDays: 365,
      },
    });
    return this.get(t, id);
  }

  /** Reprogramar (arrastrar y soltar en la agenda). */
  @Post('appointments/:id/reschedule')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: AppointmentDto })
  async reschedule(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: RescheduleDto,
  ) {
    const current = await this.prisma.run(tenantDb(t), (tx) => load(tx, t.barbershopId, id));
    this.assertCanManage(t, current.staff.id);
    if (dto.staffId) this.assertCanManage(t, dto.staffId);
    const rules = await this.prisma.run(tenantDb(t), (tx) => rulesOf(tx, t.barbershopId));
    await this.booking.reschedule({
      db: tenantDb(t),
      barbershopId: t.barbershopId,
      appointmentId: id,
      staffId: dto.staffId ?? null,
      startAt: new Date(dto.startAt),
      enforceSchedule: !dto.force,
      rules: {
        slotIntervalMinutes: rules.slotIntervalMinutes,
        minNoticeMinutes: 0,
        maxAdvanceDays: 365,
      },
    });
    await this.prisma.run(tenantDb(t), (tx) =>
      this.audit.record(tx, {
        action: 'shop.appointment.reschedule',
        barbershopId: t.barbershopId,
        entity: 'appointment',
        entityId: id,
        diff: { from: current.startAt.toISOString(), to: dto.startAt, staffId: dto.staffId },
      }),
    );
    return this.get(t, id);
  }

  @Post('appointments/:id/status')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: AppointmentDto })
  async changeStatus(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      const a = await load(tx, t.barbershopId, id);
      this.assertCanManage(t, a.staff.id);
      await applyStatus(tx, a.id, a.status, dto.status, dto.reason, a.customer?.id ?? null);
      if (dto.status === 'confirmed' || dto.status === 'canceled')
        await this.notifications.onAppointment(tx, dto.status, a.id);
      await this.audit.record(tx, {
        action: `shop.appointment.${dto.status}`,
        barbershopId: t.barbershopId,
        entity: 'appointment',
        entityId: id,
        diff: { from: a.status, to: dto.status, reason: dto.reason },
      });
    });
    return this.get(t, id);
  }

  @Patch('appointments/:id')
  @ZodResponse({ type: AppointmentDto })
  async updateNotes(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateNotesDto,
  ) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      const a = await load(tx, t.barbershopId, id);
      this.assertCanManage(t, a.staff.id);
      await tx.appointment.update({ where: { id }, data: dto });
    });
    return this.get(t, id);
  }

  private async bookOrSuggest(
    t: TenantContext,
    input: Omit<
      Parameters<BookingService['book']>[0],
      'db' | 'barbershopId' | 'onlineOnly' | 'createdByUserId'
    >,
  ): Promise<string> {
    const full = {
      ...input,
      db: tenantDb(t),
      barbershopId: t.barbershopId,
      onlineOnly: false,
      createdByUserId: t.userId,
    };
    try {
      return await this.booking.book(full);
    } catch (e) {
      if (e instanceof AppError && e.code === 'SLOT_TAKEN') {
        const alternatives = await this.booking.alternatives(full, input.startAt);
        throw new AppError(e.code, e.status, e.message, {
          alternatives: alternatives.map((d) => d.toISOString()),
        });
      }
      throw e;
    }
  }

  private assertCanView(t: TenantContext, staffId?: string | null): void {
    if (can(t, 'appointments.view_all')) return;
    if (can(t, 'appointments.view_own') && (!staffId || staffId === t.staffId)) return;
    throw AppError.forbidden();
  }

  private assertCanManage(t: TenantContext, staffId: string | null): void {
    if (can(t, 'appointments.manage_all')) return;
    if (can(t, 'appointments.manage_own') && staffId && staffId === t.staffId) return;
    throw AppError.forbidden('Solo puedes gestionar tus propias citas');
  }
}

export async function load(tx: Tx, barbershopId: string, id: string) {
  const a = await tx.appointment.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: appointmentSelect,
  });
  if (!a) throw AppError.notFound('Cita');
  return a;
}

export async function rulesOf(tx: Tx, barbershopId: string) {
  const s = await tx.barbershopSettings.findUnique({
    where: { barbershopId },
    select: { bookingRules: true },
  });
  return readBookingRules(s?.bookingRules);
}

/** Aplica una transición de estado con sus efectos (contadores del cliente, marcas de tiempo). */
export async function applyStatus(
  tx: Tx,
  id: string,
  from: AppointmentStatus,
  to: AppointmentStatus,
  reason: string | undefined,
  customerId: string | null,
): Promise<void> {
  if (!TRANSITIONS[from].includes(to))
    throw AppError.conflict(`No se puede pasar de "${from}" a "${to}"`);
  const now = new Date();
  await tx.appointment.update({
    where: { id },
    data: {
      status: to,
      ...(to === 'confirmed' ? { confirmedAt: now } : {}),
      ...(to === 'in_progress' ? { startedAt: now } : {}),
      ...(to === 'completed' ? { completedAt: now } : {}),
      ...(to === 'canceled' ? { canceledAt: now, cancelReason: reason ?? null } : {}),
    },
  });
  // Adelanto ya pagado: cancelar → devolver; no se presentó → retener (según la regla).
  if ((to === 'canceled' || to === 'no_show') && from !== 'awaiting_payment')
    await onDepositAppointmentClosed(tx, id, to);
  // Cancelar una reserva apartada: el adelanto vence y su link de pago deja de servir.
  if (from === 'awaiting_payment' && to === 'canceled') {
    const dep = await tx.appointmentDeposit.findUnique({
      where: { appointmentId: id },
      select: { id: true, chargeId: true, status: true },
    });
    if (dep?.status === 'pending') {
      await tx.appointmentDeposit.update({
        where: { id: dep.id },
        data: { status: 'expired', resolvedAt: now },
      });
      if (dep.chargeId)
        await tx.paymentCharge.updateMany({
          where: { id: dep.chargeId, status: 'pending' },
          data: { status: 'canceled' },
        });
    }
  }
  if (customerId && to === 'no_show') {
    await tx.customer.update({
      where: { id: customerId },
      data: { noShowCount: { increment: 1 } },
    });
  }
  if (customerId && to === 'completed') {
    await tx.customer.update({ where: { id: customerId }, data: { lastVisitAt: now } });
  }
}

export function groupByDay(
  slots: Array<{ start: Date; staffIds: string[] }>,
  timezone: string,
  showStaff: boolean,
  quotes: Array<{ staffId: string; displayName: string; durationMin: number; priceCents: number }>,
) {
  const days = new Map<string, Array<{ start: Date; staffIds?: string[] }>>();
  for (const s of slots) {
    const d = utcToLocalDate(s.start, timezone);
    days.set(d, [...(days.get(d) ?? []), showStaff ? s : { start: s.start }]);
  }
  return {
    timezone,
    days: [...days.entries()].map(([date, list]) => ({ date, slots: list })),
    staff: showStaff
      ? quotes.map(({ staffId, displayName, durationMin, priceCents }) => ({
          staffId,
          displayName,
          durationMin,
          priceCents,
        }))
      : [],
  };
}
