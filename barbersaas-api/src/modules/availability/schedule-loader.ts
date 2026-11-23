import { fromDbTime, type TimeBlock } from '../../common/time/time-blocks';
import type { Tx } from '../../infra/prisma/prisma.service';
import type { EngineLocation, EngineStaff, LocalDate } from './engine';
import type { Interval } from './intervals';

/** Horario de un barbero sin citas ni duración (lo que define cuándo trabaja). */
export type StaffSchedule = Pick<
  EngineStaff,
  'id' | 'customHours' | 'weekly' | 'breaks' | 'timeOff'
>;

export interface ScheduleStaffRef {
  id: string;
  locationId: string;
  customHours: boolean;
}

/** Margen de ±1 día en UTC para cubrir cualquier zona horaria. */
export function utcRange(from: LocalDate, to: LocalDate): { start: Date; end: Date } {
  return {
    start: new Date(new Date(`${from}T00:00:00Z`).getTime() - 86_400_000),
    end: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * 86_400_000),
  };
}

/**
 * Carga horarios de sede (semanal, feriados, excepciones) y de cada barbero (horario propio,
 * descansos, ausencias) para un rango de días locales. Lo usan la disponibilidad y los reportes
 * (ocupación). Debe llamarse dentro de una transacción con contexto de tenant.
 */
export async function loadSchedules(
  tx: Tx,
  q: {
    barbershopId: string;
    staff: ScheduleStaffRef[];
    tzOf: (locationId: string) => string;
    from: LocalDate;
    to: LocalDate;
  },
): Promise<{ locations: Map<string, EngineLocation>; staff: Map<string, StaffSchedule> }> {
  const staffIds = q.staff.map((s) => s.id);
  const locationIds = [...new Set(q.staff.map((s) => s.locationId))];
  const range = utcRange(q.from, q.to);
  const dates = { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) };
  const [hours, exceptions, holidays, staffHours, timeOff] = await Promise.all([
    tx.businessHour.findMany({
      where: { barbershopId: q.barbershopId, locationId: { in: locationIds }, deletedAt: null },
    }),
    tx.scheduleException.findMany({
      where: {
        barbershopId: q.barbershopId,
        locationId: { in: locationIds },
        deletedAt: null,
        date: dates,
      },
    }),
    tx.holiday.findMany({
      where: {
        barbershopId: q.barbershopId,
        deletedAt: null,
        OR: [{ locationId: null }, { locationId: { in: locationIds } }],
        date: dates,
      },
    }),
    tx.staffHour.findMany({
      where: { barbershopId: q.barbershopId, staffId: { in: staffIds }, deletedAt: null },
    }),
    tx.staffTimeOff.findMany({
      where: {
        barbershopId: q.barbershopId,
        staffId: { in: staffIds },
        deletedAt: null,
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
      },
      select: { staffId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const byDay = (rows: Array<{ dayOfWeek: number; a: Date; b: Date }>) => {
    const m = new Map<number, TimeBlock[]>();
    for (const r of rows)
      m.set(r.dayOfWeek, [
        ...(m.get(r.dayOfWeek) ?? []),
        { start: fromDbTime(r.a), end: fromDbTime(r.b) },
      ]);
    return m;
  };

  const locations = new Map<string, EngineLocation>();
  for (const locationId of locationIds)
    locations.set(locationId, {
      timezone: q.tzOf(locationId),
      weekly: byDay(
        hours
          .filter((h) => h.locationId === locationId)
          .map((h) => ({ dayOfWeek: h.dayOfWeek, a: h.opensAt, b: h.closesAt })),
      ),
      holidays: new Set(
        holidays
          .filter((h) => !h.locationId || h.locationId === locationId)
          .map((h) => h.date.toISOString().slice(0, 10)),
      ),
      exceptions: new Map(
        exceptions
          .filter((e) => e.locationId === locationId)
          .map((e) => [
            e.date.toISOString().slice(0, 10),
            {
              closed: e.isClosed,
              blocks:
                e.isClosed || !e.opensAt || !e.closesAt
                  ? []
                  : [{ start: fromDbTime(e.opensAt), end: fromDbTime(e.closesAt) }],
            },
          ]),
      ),
    });

  const staff = new Map<string, StaffSchedule>();
  for (const s of q.staff) {
    const own = staffHours.filter((h) => h.staffId === s.id);
    staff.set(s.id, {
      id: s.id,
      customHours: s.customHours,
      weekly: byDay(
        own
          .filter((h) => h.kind === 'work')
          .map((h) => ({ dayOfWeek: h.dayOfWeek, a: h.startsAt, b: h.endsAt })),
      ),
      breaks: byDay(
        own
          .filter((h) => h.kind === 'break')
          .map((h) => ({ dayOfWeek: h.dayOfWeek, a: h.startsAt, b: h.endsAt })),
      ),
      timeOff: timeOff
        .filter((x) => x.staffId === s.id)
        .map((x) => [x.startsAt.getTime(), x.endsAt.getTime()] as Interval),
    });
  }
  return { locations, staff };
}
