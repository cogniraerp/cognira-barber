import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';

/** Invalida todo lo de la barbería (incluye contexto y onboarding, que dependen de casi todo). */
export function useRefreshShop() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/shop') });
}

export const saved = (msg = 'Cambios guardados') => toast.success(msg);
export const failed = (e: unknown) => toast.error(errorMessage(e, i18n.t));

export type Block = { start: string; end: string };
export type Day = { dayOfWeek: number; blocks: Block[]; breaks?: Block[] };
export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/** Lunes primero (como se piensa la semana en Perú). */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * La API reporta errores como `days.{i}.blocks.{j}` donde i es la posición en lo ENVIADO
 * (sin los días cerrados): se traducen a día de la semana.
 */
export function weekErrors(fieldErrors: Record<string, string>, sent: Array<{ dayOfWeek: number }>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [path, msg] of Object.entries(fieldErrors)) {
    const m = /^days\.(\d+)\./.exec(path);
    const dow = m ? sent[Number(m[1])]?.dayOfWeek : undefined;
    if (dow !== undefined && !out[dow]) out[dow] = msg;
  }
  return out;
}

/** Ordena para la API y descarta días cerrados. */
export function toApiWeek(days: Day[], withBreaks = false) {
  return days
    .filter((d) => d.blocks.length || (withBreaks && d.breaks?.length))
    .map((d) => (withBreaks ? { dayOfWeek: d.dayOfWeek, blocks: d.blocks, breaks: d.breaks ?? [] } : { dayOfWeek: d.dayOfWeek, blocks: d.blocks }));
}
