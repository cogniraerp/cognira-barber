import { fromWall, localDate, parseWall } from './dates';

export type PeriodKey = 'hoy' | 'semana' | 'mes' | 'mes-pasado' | 'anio' | 'rango';
export const PERIOD_LABEL: Record<PeriodKey, string> = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', 'mes-pasado': 'Mes pasado', anio: 'Este año', rango: 'Personalizado' };

const addDays = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day! + n)).toISOString().slice(0, 10);
};

/**
 * Rango [desde, hasta) en fechas locales de la barbería y como ISO para la API.
 * Semana de lunes a domingo; "hasta" es exclusivo (el día siguiente al último).
 */
export function periodRange(key: PeriodKey, tz: string, now: Date, custom?: { desde?: string; hasta?: string }) {
  const today = localDate(now, tz);
  const [y, m] = today.split('-').map(Number);
  let from: string;
  let toExcl: string;
  if (key === 'hoy') {
    from = today;
    toExcl = addDays(today, 1);
  } else if (key === 'anio') {
    from = `${y}-01-01`;
    toExcl = `${y! + 1}-01-01`;
  } else if (key === 'semana') {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    from = addDays(today, -((dow + 6) % 7));
    toExcl = addDays(from, 7);
  } else if (key === 'mes') {
    from = `${y}-${String(m).padStart(2, '0')}-01`;
    toExcl = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  } else if (key === 'mes-pasado') {
    from = new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 10);
    toExcl = `${y}-${String(m).padStart(2, '0')}-01`;
  } else {
    from = custom?.desde || today;
    toExcl = addDays(custom?.hasta || from, 1);
  }
  return {
    from,
    toInclusive: addDays(toExcl, -1),
    fromIso: fromWall(parseWall(from, '00:00'), tz),
    toIso: fromWall(parseWall(toExcl, '00:00'), tz),
  };
}
