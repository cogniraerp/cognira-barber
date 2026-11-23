import type { BillingNoticeKind } from '../../generated/prisma/enums';

const DAY = 86_400_000;

export interface DunningConfig {
  renewalLeadDays: number;
  reminderDays: number;
  graceDays: number;
}

/**
 * Qué toca hacer con una factura abierta según su vencimiento (función pura).
 *  - Antes de vencer, dentro de `reminderDays`: recordatorio.
 *  - Vencida: la suscripción pasa a morosa y se avisa.
 *  - A 2 días del corte: último aviso.
 *  - Pasados `graceDays`: se suspende la barbería.
 * Se envía solo el aviso más grave que corresponda (si el worker estuvo detenido no llegan todos juntos).
 */
export function invoiceStage(
  dueAt: Date,
  now: Date,
  cfg: DunningConfig,
): { notice: BillingNoticeKind | null; pastDue: boolean; suspend: boolean } {
  const diff = now.getTime() - dueAt.getTime();
  if (diff < 0) {
    return {
      notice: -diff <= cfg.reminderDays * DAY ? 'due_soon' : null,
      pastDue: false,
      suspend: false,
    };
  }
  const days = diff / DAY;
  if (days >= cfg.graceDays) return { notice: 'suspended', pastDue: true, suspend: true };
  if (cfg.graceDays > 2 && days >= cfg.graceDays - 2)
    return { notice: 'final_warning', pastDue: true, suspend: false };
  return { notice: 'overdue', pastDue: true, suspend: false };
}

/** Fecha de corte (suspensión) de una factura. */
export const suspendsAt = (dueAt: Date, cfg: DunningConfig) =>
  new Date(dueAt.getTime() + cfg.graceDays * DAY);

/** ¿Toca emitir la factura del siguiente periodo? (a `renewalLeadDays` del fin del periodo o de la prueba). */
export const renewalDue = (anchor: Date, now: Date, cfg: DunningConfig) =>
  anchor.getTime() - now.getTime() <= cfg.renewalLeadDays * DAY;

/** Monto del periodo con el descuento de la suscripción. */
export function periodAmount(
  interval: 'month' | 'year',
  plan: { priceMonthlyCents: number; priceYearlyCents: number },
  discountPercent: number,
): number {
  const list = interval === 'year' ? plan.priceYearlyCents : plan.priceMonthlyCents;
  return Math.round((list * (100 - discountPercent)) / 100);
}
