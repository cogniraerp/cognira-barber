import type { AgendaTimeOffListDtoItem } from '@/api/generated/model';
import type { Appt } from '../agenda/agenda-utils';

export type Item =
  | { kind: 'appt'; start: number; end: number; appt: Appt }
  | { kind: 'off'; start: number; end: number; off: AgendaTimeOffListDtoItem }
  | { kind: 'gap'; start: number; end: number };

const MIN_GAP = 20 * 60_000;

/**
 * Citas + bloqueos en orden, con los huecos libres (≥ 20 min) entre ellos. Si se pasa el horario
 * de atención del día (intervalos en ms), los huecos se recortan a él: el almuerzo no es "libre".
 */
export function timeline(appts: Appt[], offs: AgendaTimeOffListDtoItem[], open?: Array<[number, number]>): Item[] {
  const items: Item[] = [
    ...appts.map((a): Item => ({ kind: 'appt', start: Date.parse(a.startAt), end: Date.parse(a.endAt), appt: a })),
    ...offs.map((o): Item => ({ kind: 'off', start: Date.parse(o.startsAt), end: Date.parse(o.endsAt), off: o })),
  ].sort((x, y) => x.start - y.start);
  const out: Item[] = [];
  let cursor: number | null = null;
  for (const it of items) {
    if (cursor !== null && it.start - cursor >= MIN_GAP) {
      const parts = open ? open.map(([a, b]): [number, number] => [Math.max(a, cursor!), Math.min(b, it.start)]) : [[cursor, it.start] as [number, number]];
      for (const [a, b] of parts) if (b - a >= MIN_GAP) out.push({ kind: 'gap', start: a, end: b });
    }
    out.push(it);
    cursor = Math.max(cursor ?? 0, it.end);
  }
  return out;
}

export function duration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}


/** Bloques "09:00–13:00" de un día de la sede → intervalos en ms (instantes reales). */
export function openIntervals(blocks: Array<{ start: string; end: string }>, toInstant: (hhmm: string) => number): Array<[number, number]> {
  return blocks.map((b) => [toInstant(b.start), toInstant(b.end)]);
}
