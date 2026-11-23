/** Variación respecto al período anterior: null si no hay base para comparar. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / Math.abs(previous);
}

/** Porcentaje 0–100 (null si el denominador es 0). */
export function ratio(part: number, whole: number): number | null {
  return whole ? (part / whole) * 100 : null;
}

export const fmtPct = (v: number | null, digits = 0) =>
  v === null ? '—' : `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: digits }).format(v)} %`;

/** "12 h 30 min" para minutos de agenda. */
export function fmtHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const dayLabel = (d: string, long = false) =>
  new Intl.DateTimeFormat('es-PE', long ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

export interface DayPoint { date: string; revenueCents: number; salesCount: number; tipCents: number }

/** Más de 62 días → agrupa por mes (YYYY-MM-01) para que las columnas sigan siendo legibles. */
export function bucketDays(days: DayPoint[]): { unit: 'day' | 'month'; rows: DayPoint[] } {
  if (days.length <= 62) return { unit: 'day', rows: days };
  const m = new Map<string, DayPoint>();
  for (const d of days) {
    const key = `${d.date.slice(0, 7)}-01`;
    const r = m.get(key) ?? { date: key, revenueCents: 0, salesCount: 0, tipCents: 0 };
    r.revenueCents += d.revenueCents;
    r.salesCount += d.salesCount;
    r.tipCents += d.tipCents;
    m.set(key, r);
  }
  return { unit: 'month', rows: [...m.values()] };
}

export const monthLabel = (d: string) =>
  new Intl.DateTimeFormat('es-PE', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
