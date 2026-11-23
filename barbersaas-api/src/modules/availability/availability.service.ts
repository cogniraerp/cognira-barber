import { Injectable } from '@nestjs/common';
import type { Tx } from '../../infra/prisma/prisma.service';
import { badRequest } from '../shop/shop-helpers';
import { computeSlots, eachLocalDate, type EngineStaff, type LocalDate, type Slot } from './engine';
import type { Interval } from './intervals';
import { loadSchedules, utcRange } from './schedule-loader';

/** Ocupan el horario (incluye la cita apartada mientras se paga el adelanto). */
export const ACTIVE_STATUSES = ['awaiting_payment', 'pending', 'confirmed', 'in_progress'] as const;
export const MAX_RANGE_DAYS = 31;

export interface AvailabilityQuery {
  barbershopId: string;
  serviceIds: string[];
  staffId?: string;
  locationId?: string;
  from: LocalDate;
  to: LocalDate;
  now?: Date;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  /** Página pública: solo servicios reservables en línea. */
  onlineOnly: boolean;
  /** Al reprogramar, la propia cita no cuenta como ocupada. */
  excludeAppointmentId?: string;
}

export interface StaffQuote {
  staffId: string;
  displayName: string;
  locationId: string;
  timezone: string;
  durationMin: number;
  priceCents: number;
  sortOrder: number;
}

export interface AvailabilityResult {
  slots: Slot[];
  /** Precio y duración de la combinación de servicios para cada barbero candidato. */
  quotes: Map<string, StaffQuote>;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  services: Array<{ id: string; name: string }>;
  /** Zona de la sede principal (para presentar fechas). */
  timezone: string;
}

/**
 * Carga de la BD todo lo que el motor necesita (horarios, feriados, excepciones, ausencias,
 * citas) y lo ejecuta por sede. Debe llamarse dentro de una transacción con contexto de tenant.
 */
@Injectable()
export class AvailabilityService {
  async compute(tx: Tx, q: AvailabilityQuery): Promise<AvailabilityResult> {
    const days = [...eachLocalDate(q.from, q.to)].length;
    if (days < 1) throw badRequest('to', 'El rango de fechas es inválido');
    if (days > MAX_RANGE_DAYS) throw badRequest('to', `Máximo ${MAX_RANGE_DAYS} días por consulta`);
    if (!q.serviceIds.length) throw badRequest('serviceIds', 'Elige al menos un servicio');

    const shop = await tx.barbershop.findUniqueOrThrow({
      where: { id: q.barbershopId },
      select: { timezone: true },
    });
    const services = await tx.service.findMany({
      where: {
        barbershopId: q.barbershopId,
        id: { in: q.serviceIds },
        deletedAt: null,
        isActive: true,
        ...(q.onlineOnly ? { isOnlineBookable: true } : {}),
      },
      select: {
        id: true,
        name: true,
        priceCents: true,
        durationMin: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    });
    if (services.length !== new Set(q.serviceIds).size)
      throw badRequest('serviceIds', 'Algún servicio no existe o no está disponible');
    const ordered = q.serviceIds.map((id) => services.find((s) => s.id === id)!);

    const locations = await tx.location.findMany({
      where: { barbershopId: q.barbershopId, deletedAt: null },
      select: { id: true, isPrimary: true, timezone: true },
    });
    const primary = locations.find((l) => l.isPrimary) ?? locations[0];
    if (!primary) return empty(ordered, shop.timezone);
    if (q.locationId && !locations.some((l) => l.id === q.locationId))
      throw badRequest('locationId', 'Sede inexistente');

    // Barberos activos que realizan TODOS los servicios pedidos.
    const staffRows = await tx.staff.findMany({
      where: {
        barbershopId: q.barbershopId,
        deletedAt: null,
        isActive: true,
        ...(q.staffId ? { id: q.staffId } : {}),
        AND: q.serviceIds.map((serviceId) => ({ services: { some: { serviceId } } })),
      },
      select: {
        id: true,
        displayName: true,
        locationId: true,
        customHours: true,
        sortOrder: true,
        services: {
          where: { serviceId: { in: q.serviceIds } },
          select: { serviceId: true, priceCentsOverride: true, durationMinOverride: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    const tzOf = (locationId: string) =>
      locations.find((l) => l.id === locationId)?.timezone ?? shop.timezone;
    const candidates = staffRows
      .map((s) => ({ ...s, locationId: s.locationId ?? primary.id }))
      .filter((s) => !q.locationId || s.locationId === q.locationId);
    if (!candidates.length) return empty(ordered, tzOf(primary.id));

    const quotes = new Map<string, StaffQuote>();
    for (const s of candidates) {
      let durationMin = 0;
      let priceCents = 0;
      for (const svc of ordered) {
        const o = s.services.find((x) => x.serviceId === svc.id);
        durationMin += o?.durationMinOverride ?? svc.durationMin;
        priceCents += o?.priceCentsOverride ?? svc.priceCents;
      }
      quotes.set(s.id, {
        staffId: s.id,
        displayName: s.displayName,
        locationId: s.locationId,
        timezone: tzOf(s.locationId),
        durationMin,
        priceCents,
        sortOrder: s.sortOrder,
      });
    }
    const bufferBeforeMin = ordered[0]!.bufferBeforeMin;
    const bufferAfterMin = ordered.at(-1)!.bufferAfterMin;

    const range = utcRange(q.from, q.to);
    const staffIds = candidates.map((s) => s.id);
    const locationIds = [...new Set(candidates.map((s) => s.locationId))];
    const [schedules, busy] = await Promise.all([
      loadSchedules(tx, {
        barbershopId: q.barbershopId,
        staff: candidates,
        tzOf,
        from: q.from,
        to: q.to,
      }),
      tx.appointment.findMany({
        where: {
          barbershopId: q.barbershopId,
          staffId: { in: staffIds },
          deletedAt: null,
          status: { in: [...ACTIVE_STATUSES] },
          blockStartAt: { lt: range.end },
          blockEndAt: { gt: range.start },
          ...(q.excludeAppointmentId ? { id: { not: q.excludeAppointmentId } } : {}),
        },
        select: { staffId: true, blockStartAt: true, blockEndAt: true },
      }),
    ]);

    const all: Slot[] = [];
    for (const locationId of locationIds) {
      const location = schedules.locations.get(locationId)!;
      const staff: EngineStaff[] = candidates
        .filter((s) => s.locationId === locationId)
        .map((s) => ({
          ...schedules.staff.get(s.id)!,
          busy: busy
            .filter((x) => x.staffId === s.id)
            .map((x) => [x.blockStartAt.getTime(), x.blockEndAt.getTime()] as Interval),
          durationMin: quotes.get(s.id)!.durationMin,
        }));
      all.push(
        ...computeSlots({
          location,
          staff,
          from: q.from,
          to: q.to,
          now: q.now ?? new Date(),
          bufferBeforeMin,
          bufferAfterMin,
          slotIntervalMinutes: q.slotIntervalMinutes,
          minNoticeMinutes: q.minNoticeMinutes,
          maxAdvanceDays: q.maxAdvanceDays,
        }),
      );
    }

    // Unir sedes (mismo inicio en sedes distintas → una sola entrada).
    const merged = new Map<number, string[]>();
    for (const s of all)
      merged.set(s.start.getTime(), [...(merged.get(s.start.getTime()) ?? []), ...s.staffIds]);
    const slots = [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, ids]) => ({ start: new Date(ms), staffIds: ids }));

    return {
      slots,
      quotes,
      bufferBeforeMin,
      bufferAfterMin,
      services: ordered.map((s) => ({ id: s.id, name: s.name })),
      timezone: tzOf(primary.id),
    };
  }
}

function empty(
  services: Array<{ id: string; name: string }>,
  timezone: string,
): AvailabilityResult {
  return {
    slots: [],
    quotes: new Map(),
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    services: services.map((s) => ({ id: s.id, name: s.name })),
    timezone,
  };
}
