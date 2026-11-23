import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { Prisma } from '../../generated/prisma/client';
import type { AppointmentSource, AppointmentStatus } from '../../generated/prisma/enums';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import {
  AvailabilityService,
  type AvailabilityQuery,
  type AvailabilityResult,
} from '../availability/availability.service';
import { utcToLocalDate, type LocalDate } from '../availability/engine';
import { badRequest } from '../shop/shop-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { computeDeposit } from '../deposits/deposit-rules';
import type { DepositRule } from '../shop/settings.schemas';
import { normalizePhone } from './phone';

export interface BookingRulesInput {
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export interface BookInput {
  db: DbContext;
  barbershopId: string;
  serviceIds: string[];
  /** null = "cualquier barbero disponible" */
  staffId: string | null;
  startAt: Date;
  customerId: string | null;
  source: AppointmentSource;
  status: Extract<AppointmentStatus, 'pending' | 'confirmed' | 'in_progress'>;
  customerNotes?: string | null;
  internalNotes?: string | null;
  customFields?: Record<string, unknown>;
  createdByUserId?: string | null;
  /**
   * true (reserva online / panel normal): el inicio debe ser un slot disponible según horarios y reglas.
   * false (panel con `force`, walk-in fuera de horario): solo se exige que no choque con otra cita.
   */
  enforceSchedule: boolean;
  rules: BookingRulesInput;
  onlineOnly: boolean;
  /**
   * Reserva online con adelanto (Fase 3): si el monto calculado es > 0, la cita nace en
   * `awaiting_payment`, el horario queda apartado `holdMinutes` y no se avisa hasta que se pague.
   */
  deposit?: {
    rule: DepositRule & { appliesTo: 'all' | 'new_or_no_show'; holdMinutes: number };
    customer: { completedVisits: number; noShows: number };
  };
}

export interface BookResult {
  id: string;
  /** Adelanto creado (null si no corresponde). */
  deposit: { id: string; amountCents: number; holdExpiresAt: Date } | null;
}

/** Transiciones de estado válidas. Los estados finales no se pueden reabrir. */
export const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  // Al pagarse el adelanto pasa a pending/confirmed (lo hace el sistema); se puede cancelar.
  awaiting_payment: ['canceled'],
  pending: ['confirmed', 'canceled'],
  confirmed: ['in_progress', 'completed', 'no_show', 'canceled'],
  in_progress: ['completed', 'canceled'],
  completed: [],
  no_show: [],
  canceled: [],
};

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly plans: PlanLimitsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crea una cita sin posibilidad de doble reserva:
   *  1. Calcula candidatos y BLOQUEA sus filas de staff (FOR UPDATE, en orden para evitar deadlocks):
   *     dos reservas simultáneas para el mismo barbero se ejecutan en serie.
   *  2. Recalcula la disponibilidad ya con el lock (ve lo confirmado por la otra transacción).
   *  3. Inserta. La exclusion constraint de la BD es la garantía final ante cualquier otro camino.
   */
  async book(input: BookInput): Promise<string> {
    return (await this.bookWithDeposit(input)).id;
  }

  async bookWithDeposit(input: BookInput): Promise<BookResult> {
    try {
      return await this.prisma.run(input.db, async (tx) => {
        const first = await this.availabilityFor(tx, input, input.startAt);
        const lockIds = input.staffId ? [input.staffId] : [...first.quotes.keys()];
        if (!lockIds.length) throw slotTaken('Ningún barbero realiza ese servicio');
        await lockStaff(tx, lockIds);

        const fresh = await this.availabilityFor(tx, input, input.startAt);
        const staffId = await this.pickStaff(tx, input, fresh);
        const quote = fresh.quotes.get(staffId)!;

        const start = input.startAt;
        const end = new Date(start.getTime() + quote.durationMin * 60_000);
        const shop = await tx.barbershop.findUniqueOrThrow({
          where: { id: input.barbershopId },
          select: { currency: true },
        });
        const items = await this.itemsFor(tx, input.barbershopId, staffId, input.serviceIds);
        let depositCents = 0;
        if (input.deposit) {
          const overrides = await tx.service.findMany({
            where: { id: { in: input.serviceIds } },
            select: { id: true, depositOverride: true },
          });
          depositCents = computeDeposit({
            rule: input.deposit.rule,
            customer: input.deposit.customer,
            items: items.map((it) => ({
              priceCents: it.priceCents,
              override: readOverride(overrides.find((o) => o.id === it.serviceId)?.depositOverride),
            })),
          });
        }
        const status: AppointmentStatus = depositCents > 0 ? 'awaiting_payment' : input.status;

        const appt = await tx.appointment.create({
          data: {
            barbershopId: input.barbershopId,
            locationId: quote.locationId,
            staffId,
            customerId: input.customerId,
            startAt: start,
            endAt: end,
            blockStartAt: new Date(start.getTime() - fresh.bufferBeforeMin * 60_000),
            blockEndAt: new Date(end.getTime() + fresh.bufferAfterMin * 60_000),
            status,
            source: input.source,
            totalCents: quote.priceCents,
            currency: shop.currency,
            customerNotes: input.customerNotes ?? null,
            internalNotes: input.internalNotes ?? null,
            customFields: (input.customFields ?? {}) as Prisma.InputJsonValue,
            createdByUserId: input.createdByUserId ?? null,
            confirmedAt: status === 'confirmed' ? new Date() : null,
            startedAt: status === 'in_progress' ? new Date() : null,
            items: {
              create: items.map((it, i) => ({
                ...it,
                barbershopId: input.barbershopId,
                sortOrder: i,
              })),
            },
          },
          select: { id: true },
        });
        await this.plans.consume(tx, input.barbershopId, 'bookingsPerMonth');
        if (depositCents > 0) {
          // Sin aviso todavía: la confirmación sale cuando se pague el adelanto.
          const holdExpiresAt = new Date(Date.now() + input.deposit!.rule.holdMinutes * 60_000);
          const dep = await tx.appointmentDeposit.create({
            data: {
              barbershopId: input.barbershopId,
              appointmentId: appt.id,
              amountCents: depositCents,
              holdExpiresAt,
            },
            select: { id: true },
          });
          return { id: appt.id, deposit: { id: dep.id, amountCents: depositCents, holdExpiresAt } };
        }
        // En la misma transacción: si la cita existe, sus mensajes y recordatorios también.
        await this.notifications.onAppointment(tx, 'created', appt.id);
        return { id: appt.id, deposit: null };
      });
    } catch (e) {
      if (isOverlapViolation(e)) throw slotTaken();
      throw e;
    }
  }

  /** Mueve una cita (drag & drop en la agenda o reprogramación del cliente). Recalcula precio/duración si cambia el barbero. */
  async reschedule(
    input: Omit<BookInput, 'customerId' | 'source' | 'status' | 'serviceIds' | 'onlineOnly'> & {
      appointmentId: string;
      onlineOnly?: boolean;
    },
  ): Promise<void> {
    try {
      await this.prisma.run(input.db, async (tx) => {
        const appt = await tx.appointment.findFirst({
          where: { id: input.appointmentId, barbershopId: input.barbershopId, deletedAt: null },
          select: {
            id: true,
            status: true,
            staffId: true,
            items: { select: { serviceId: true }, orderBy: { sortOrder: 'asc' } },
          },
        });
        if (!appt) throw AppError.notFound('Cita');
        if (!['pending', 'confirmed'].includes(appt.status))
          throw AppError.conflict('Solo se pueden reprogramar citas pendientes o confirmadas');

        const base = {
          ...input,
          staffId: input.staffId ?? appt.staffId,
          serviceIds: appt.items.map((i) => i.serviceId),
          onlineOnly: input.onlineOnly ?? false,
          customerId: null,
          source: 'staff' as const,
          status: 'confirmed' as const,
        };
        await lockStaff(tx, [...new Set([appt.staffId, base.staffId])]);
        const fresh = await this.availabilityFor(tx, base, input.startAt, appt.id);
        const staffId = await this.pickStaff(tx, base, fresh);
        const quote = fresh.quotes.get(staffId)!;
        const end = new Date(input.startAt.getTime() + quote.durationMin * 60_000);

        await tx.appointmentService.deleteMany({ where: { appointmentId: appt.id } });
        const items = await this.itemsFor(tx, input.barbershopId, staffId, base.serviceIds);
        await tx.appointment.update({
          where: { id: appt.id },
          data: {
            staffId,
            locationId: quote.locationId,
            startAt: input.startAt,
            endAt: end,
            blockStartAt: new Date(input.startAt.getTime() - fresh.bufferBeforeMin * 60_000),
            blockEndAt: new Date(end.getTime() + fresh.bufferAfterMin * 60_000),
            totalCents: quote.priceCents,
            items: {
              create: items.map((it, i) => ({
                ...it,
                barbershopId: input.barbershopId,
                sortOrder: i,
              })),
            },
          },
        });
        await this.notifications.onAppointment(tx, 'rescheduled', appt.id);
      });
    } catch (e) {
      if (isOverlapViolation(e)) throw slotTaken();
      throw e;
    }
  }

  /** Próximos inicios libres el mismo día (para sugerir alternativas tras un SLOT_TAKEN). */
  async alternatives(
    input: Pick<
      BookInput,
      'db' | 'barbershopId' | 'serviceIds' | 'staffId' | 'rules' | 'onlineOnly'
    >,
    around: Date,
    limit = 6,
  ): Promise<Date[]> {
    return this.prisma.run(input.db, async (tx) => {
      const tz = await shopTimezone(tx, input.barbershopId);
      const day = utcToLocalDate(around, tz);
      const r = await this.availability.compute(tx, this.query(input, day, day));
      return r.slots
        .filter((s) => !input.staffId || s.staffIds.includes(input.staffId))
        .slice(0, limit)
        .map((s) => s.start);
    });
  }

  query(
    input: Pick<BookInput, 'barbershopId' | 'serviceIds' | 'staffId' | 'rules' | 'onlineOnly'>,
    from: LocalDate,
    to: LocalDate,
    excludeAppointmentId?: string,
  ): AvailabilityQuery {
    return {
      barbershopId: input.barbershopId,
      serviceIds: input.serviceIds,
      staffId: input.staffId ?? undefined,
      from,
      to,
      slotIntervalMinutes: input.rules.slotIntervalMinutes,
      minNoticeMinutes: input.rules.minNoticeMinutes,
      maxAdvanceDays: input.rules.maxAdvanceDays,
      onlineOnly: input.onlineOnly,
      excludeAppointmentId,
    };
  }

  private async availabilityFor(
    tx: Tx,
    input: BookInput,
    at: Date,
    excludeAppointmentId?: string,
  ): Promise<AvailabilityResult> {
    const tz = await shopTimezone(tx, input.barbershopId);
    const day = utcToLocalDate(at, tz);
    // ±1 día por si la sede del barbero está en otra zona horaria que la barbería.
    const shift = (d: string, n: number) =>
      new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const q = this.query(
      { ...input, staffId: input.staffId },
      shift(day, -1),
      shift(day, 1),
      excludeAppointmentId,
    );
    if (!input.enforceSchedule) Object.assign(q, { minNoticeMinutes: -1e6, maxAdvanceDays: 3650 });
    return this.availability.compute(tx, q);
  }

  private async pickStaff(tx: Tx, input: BookInput, r: AvailabilityResult): Promise<string> {
    if (!input.enforceSchedule) {
      if (!input.staffId)
        throw badRequest('staffId', 'Para forzar una cita fuera de horario elige el barbero');
      if (!r.quotes.has(input.staffId))
        throw badRequest('staffId', 'Ese barbero no realiza el/los servicio(s) elegidos');
      return input.staffId;
    }
    const slot = r.slots.find((s) => s.start.getTime() === input.startAt.getTime());
    const candidates = slot
      ? slot.staffIds.filter((id) => !input.staffId || id === input.staffId)
      : [];
    if (!candidates.length) throw slotTaken();
    if (candidates.length === 1) return candidates[0]!;

    // "Cualquiera": el que tenga menos citas ese día; empate → orden de aparición.
    const tz = r.quotes.get(candidates[0]!)!.timezone;
    const day = utcToLocalDate(input.startAt, tz);
    const dayStart = new Date(`${day}T00:00:00Z`).getTime() - 86_400_000;
    const nearby = await tx.appointment.findMany({
      where: {
        barbershopId: input.barbershopId,
        staffId: { in: candidates },
        deletedAt: null,
        status: { in: ['awaiting_payment', 'pending', 'confirmed', 'in_progress'] },
        startAt: { gte: new Date(dayStart), lt: new Date(dayStart + 3 * 86_400_000) },
      },
      select: { staffId: true, startAt: true },
    });
    const count = (id: string) =>
      nearby.filter((a) => a.staffId === id && utcToLocalDate(a.startAt, tz) === day).length;
    return [...candidates].sort(
      (a, b) => count(a) - count(b) || r.quotes.get(a)!.sortOrder - r.quotes.get(b)!.sortOrder,
    )[0]!;
  }

  private async itemsFor(tx: Tx, barbershopId: string, staffId: string, serviceIds: string[]) {
    const rows = await tx.service.findMany({
      where: { barbershopId, id: { in: serviceIds } },
      select: {
        id: true,
        name: true,
        priceCents: true,
        durationMin: true,
        staffServices: {
          where: { staffId },
          select: { priceCentsOverride: true, durationMinOverride: true },
        },
      },
    });
    return serviceIds.map((id) => {
      const s = rows.find((r) => r.id === id)!;
      const o = s.staffServices[0];
      return {
        serviceId: s.id,
        nameSnapshot: s.name,
        priceCents: o?.priceCentsOverride ?? s.priceCents,
        durationMin: o?.durationMinOverride ?? s.durationMin,
      };
    });
  }
}

/** Excepción de adelanto guardada en el servicio (tolerante: si no es válida, se ignora). */
function readOverride(raw: unknown): DepositRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<DepositRule>;
  if (typeof r.required !== 'boolean' || !['percent', 'fixed', 'full'].includes(r.type ?? ''))
    return null;
  return { required: r.required, type: r.type!, value: Number(r.value) || 0 };
}

// ─────────────────────────── clientes ───────────────────────────

export interface CustomerInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
}

/** Busca al cliente por teléfono (o email) dentro de la barbería; si no existe, lo crea. */
export async function resolveCustomer(
  tx: Tx,
  barbershopId: string,
  input: CustomerInput,
  country: string,
  userId?: string | null,
): Promise<{ id: string; isBlocked: boolean }> {
  const phoneE164 = input.phone ? normalizePhone(input.phone, country) : null;
  if (input.phone && !phoneE164) throw badRequest('customer.phone', 'Teléfono inválido');
  const email = input.email?.trim().toLowerCase() || null;
  if (!phoneE164 && !email) throw badRequest('customer.phone', 'Indica un teléfono o un email');

  const existing = await tx.customer.findFirst({
    where: { barbershopId, deletedAt: null, ...(phoneE164 ? { phoneE164 } : { email }) },
    select: { id: true, isBlocked: true, email: true, userId: true },
  });
  if (existing) {
    const patch: Prisma.CustomerUpdateInput = {};
    if (email && !existing.email) patch.email = email;
    if (userId && !existing.userId) patch.user = { connect: { id: userId } };
    if (Object.keys(patch).length)
      await tx.customer.update({ where: { id: existing.id }, data: patch });
    return { id: existing.id, isBlocked: existing.isBlocked };
  }
  const c = await tx.customer.create({
    data: {
      barbershopId,
      fullName: input.fullName.trim(),
      phoneE164,
      email,
      userId: userId ?? null,
    },
    select: { id: true, isBlocked: true },
  });
  return c;
}

// ─────────────────────────── utilidades ───────────────────────────

async function lockStaff(tx: Tx, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT id FROM staff WHERE id = ANY(${sorted}::uuid[]) ORDER BY id FOR UPDATE`;
}

async function shopTimezone(tx: Tx, barbershopId: string): Promise<string> {
  return (
    await tx.barbershop.findUniqueOrThrow({
      where: { id: barbershopId },
      select: { timezone: true },
    })
  ).timezone;
}

export function slotTaken(message = 'Ese horario ya no está disponible'): AppError {
  return new AppError(ErrorCode.SLOT_TAKEN, HttpStatus.CONFLICT, message);
}

/** La exclusion constraint `appointments_no_overlap` (SQLSTATE 23P01), venga como venga envuelta. */
export function isOverlapViolation(e: unknown): boolean {
  const text = (x: unknown): string => {
    try {
      return JSON.stringify(x, Object.getOwnPropertyNames(x ?? {}));
    } catch {
      return String(x);
    }
  };
  return /appointments_no_overlap|23P01/.test(text(e));
}
