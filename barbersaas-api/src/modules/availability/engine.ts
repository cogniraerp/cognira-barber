import { TZDate } from '@date-fns/tz';
import { toMinutes, type TimeBlock } from '../../common/time/time-blocks';
import { contains, intersect, normalize, overlapsAny, subtract, type Interval } from './intervals';

/**
 * MOTOR DE DISPONIBILIDAD — función pura, sin I/O.
 *
 * Para cada día local del rango y cada barbero:
 *   1. Horario de la sede del día: excepción puntual > feriado (cerrado) > horario semanal.
 *   2. Horario del barbero: el de la sede, o su horario propio ∩ el de la sede (nunca fuera de él).
 *   3. Tiempo libre = horario − descansos − ausencias/bloqueos − citas existentes.
 *   4. Candidatos en una grilla local (múltiplos de `slotIntervalMinutes` desde medianoche).
 *      Un candidato vale si:
 *        · el servicio [inicio, inicio + duración) cabe entero en el tiempo libre, y
 *        · el bloque con buffers [inicio − bufferAntes, fin + bufferDespués) no pisa otra cita
 *          (es exactamente lo que garantiza la exclusion constraint de la BD).
 *      Los buffers sí pueden extenderse sobre un descanso o el cierre (limpieza/preparación).
 *   5. Ventana de reserva: inicio ≥ ahora + anticipación mínima y < ahora + anticipación máxima.
 *
 * Todo se calcula en hora local de la sede y se convierte a UTC con su zona horaria
 * (los huecos de cambio de horario se resuelven corriendo la hora hacia adelante).
 */

export type LocalDate = string; // YYYY-MM-DD

export interface DayOverride {
  closed: boolean;
  blocks: TimeBlock[];
}

export interface EngineLocation {
  timezone: string;
  /** dayOfWeek (0 = domingo) → bloques */
  weekly: ReadonlyMap<number, TimeBlock[]>;
  holidays: ReadonlySet<LocalDate>;
  exceptions: ReadonlyMap<LocalDate, DayOverride>;
}

export interface EngineStaff {
  id: string;
  customHours: boolean;
  weekly: ReadonlyMap<number, TimeBlock[]>;
  breaks: ReadonlyMap<number, TimeBlock[]>;
  timeOff: Interval[];
  /** Citas activas: [block_start, block_end) (ya incluyen sus buffers). */
  busy: Interval[];
  /** Duración del servicio PARA ESTE barbero (puede tener override). */
  durationMin: number;
}

export interface EngineInput {
  location: EngineLocation;
  staff: EngineStaff[];
  from: LocalDate;
  to: LocalDate;
  now: Date;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export interface Slot {
  start: Date;
  /** Barberos disponibles en ese inicio (ordenados como en la entrada). */
  staffIds: string[];
}

const MIN = 60_000;

export function computeSlots(input: EngineInput): Slot[] {
  const { location, now } = input;
  const earliest = now.getTime() + input.minNoticeMinutes * MIN;
  const latest = now.getTime() + input.maxAdvanceDays * 1440 * MIN;
  const bySlot = new Map<number, string[]>();

  for (const date of eachLocalDate(input.from, input.to)) {
    const locBlocks = locationBlocksFor(location, date);
    if (!locBlocks.length) continue;
    const locUtc = blocksToUtc(locBlocks, date, location.timezone);

    for (const st of input.staff) {
      const dow = dayOfWeek(date);
      const work = st.customHours
        ? intersect(blocksToUtc(st.weekly.get(dow) ?? [], date, location.timezone), locUtc)
        : locUtc;
      if (!work.length) continue;
      const breaks = blocksToUtc(st.breaks.get(dow) ?? [], date, location.timezone);
      const busy = normalize(st.busy);
      const free = subtract(work, [...breaks, ...st.timeOff, ...busy]);
      if (!free.length) continue;

      const seen = new Set<number>(); // en un hueco de DST dos minutos locales caen en el mismo instante
      for (const minute of gridMinutes(work, date, location.timezone, input.slotIntervalMinutes)) {
        const start = localToUtc(date, minute, location.timezone);
        if (seen.has(start)) continue;
        seen.add(start);
        if (start < earliest || start >= latest) continue;
        const end = start + st.durationMin * MIN;
        if (!contains(free, [start, end])) continue;
        if (
          overlapsAny(busy, [start - input.bufferBeforeMin * MIN, end + input.bufferAfterMin * MIN])
        )
          continue;
        const list = bySlot.get(start) ?? [];
        list.push(st.id);
        bySlot.set(start, list);
      }
    }
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, staffIds]) => ({ start: new Date(ms), staffIds }));
}

/**
 * Tiempo de trabajo de un barbero en un día (sin mirar sus citas): horario (propio ∩ sede, o el
 * de la sede) − descansos − ausencias. Base de la ocupación de la agenda en los reportes.
 */
export function workingIntervals(
  location: EngineLocation,
  staff: Pick<EngineStaff, 'customHours' | 'weekly' | 'breaks' | 'timeOff'>,
  date: LocalDate,
): Interval[] {
  const locBlocks = locationBlocksFor(location, date);
  if (!locBlocks.length) return [];
  const locUtc = blocksToUtc(locBlocks, date, location.timezone);
  const dow = dayOfWeek(date);
  const work = staff.customHours
    ? intersect(blocksToUtc(staff.weekly.get(dow) ?? [], date, location.timezone), locUtc)
    : locUtc;
  if (!work.length) return [];
  return subtract(work, [
    ...blocksToUtc(staff.breaks.get(dow) ?? [], date, location.timezone),
    ...staff.timeOff,
  ]);
}

/** Minutos totales de una lista de intervalos. */
export function totalMinutes(list: Interval[]): number {
  return normalize(list).reduce((n, [s, e]) => n + (e - s) / MIN, 0);
}

/** Horario de la sede para un día concreto: excepción > feriado > semanal. */
export function locationBlocksFor(loc: EngineLocation, date: LocalDate): TimeBlock[] {
  const ex = loc.exceptions.get(date);
  if (ex) return ex.closed ? [] : ex.blocks;
  if (loc.holidays.has(date)) return [];
  return loc.weekly.get(dayOfWeek(date)) ?? [];
}

// ─────────────────────────── helpers de tiempo ───────────────────────────

export function* eachLocalDate(from: LocalDate, to: LocalDate): Generator<LocalDate> {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const end = Date.UTC(ty, tm - 1, td);
  for (let t = Date.UTC(fy, fm - 1, fd); t <= end; t += 86_400_000)
    yield new Date(t).toISOString().slice(0, 10);
}

export function dayOfWeek(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function localToUtc(date: LocalDate, minuteOfDay: number, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new TZDate(
    y,
    m - 1,
    d,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    0,
    0,
    tz,
  ).getTime();
}

/** Fecha local (YYYY-MM-DD) de un instante en una zona horaria. */
export function utcToLocalDate(instant: Date, tz: string): LocalDate {
  const z = new TZDate(instant.getTime(), tz);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

function blocksToUtc(blocks: TimeBlock[], date: LocalDate, tz: string): Interval[] {
  return normalize(
    blocks.map(
      (b) =>
        [
          localToUtc(date, toMinutes(b.start), tz),
          localToUtc(date, toMinutes(b.end), tz),
        ] as Interval,
    ),
  );
}

/** Minutos del día en la grilla (múltiplos del intervalo) que caen dentro de algún bloque de trabajo. */
function gridMinutes(work: Interval[], date: LocalDate, tz: string, step: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 1440; m += step) {
    const t = localToUtc(date, m, tz);
    if (work.some(([s, e]) => t >= s && t < e)) out.push(m);
  }
  return out;
}
