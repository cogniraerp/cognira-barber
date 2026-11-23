import { z } from 'zod';

/**
 * Horarios recurrentes en hora LOCAL "HH:mm" (00:00–23:59). Se guardan en columnas `time`
 * y se interpretan con la zona horaria de la sede.
 * Horarios que cruzan medianoche (p. ej. 20:00–02:00) no están soportados en la Fase 1.
 */
export const HHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora en formato HH:mm (00:00–23:59)');

export const TimeBlockSchema = z.object({ start: HHmm, end: HHmm });
export type TimeBlock = z.infer<typeof TimeBlockSchema>;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Prisma representa `time` como Date en 1970-01-01 UTC. */
export function toDbTime(hhmm: string): Date {
  const min = toMinutes(hhmm);
  return new Date(Date.UTC(1970, 0, 1, Math.floor(min / 60), min % 60));
}

export function fromDbTime(d: Date): string {
  return d.toISOString().slice(11, 16);
}

/** Problemas de una lista de bloques: fin ≤ inicio o solapamientos. Devuelve mensajes con índice. */
export function blockIssues(blocks: TimeBlock[]): Array<{ index: number; message: string }> {
  const issues: Array<{ index: number; message: string }> = [];
  blocks.forEach((b, i) => {
    if (toMinutes(b.end) <= toMinutes(b.start))
      issues.push({ index: i, message: 'La hora de fin debe ser posterior a la de inicio' });
  });
  const sorted = blocks
    .map((b, i) => ({ ...b, i }))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let k = 1; k < sorted.length; k++) {
    if (toMinutes(sorted[k]!.start) < toMinutes(sorted[k - 1]!.end)) {
      issues.push({ index: sorted[k]!.i, message: 'Se superpone con otro bloque del mismo día' });
    }
  }
  return issues;
}

/** ¿Cada bloque de `inner` cae completamente dentro de algún bloque de `outer`? */
export function isContained(inner: TimeBlock, outer: TimeBlock[]): boolean {
  return outer.some(
    (o) => toMinutes(inner.start) >= toMinutes(o.start) && toMinutes(inner.end) <= toMinutes(o.end),
  );
}

export function sortBlocks(blocks: TimeBlock[]): TimeBlock[] {
  return [...blocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
