import type { DepositRule } from '../shop/settings.schemas';

export interface DepositInput {
  /** Regla general de la barbería. */
  rule: DepositRule & { appliesTo: 'all' | 'new_or_no_show' };
  /** Ítems de la reserva con su precio y la excepción de su servicio (null = regla general). */
  items: Array<{ priceCents: number; override: DepositRule | null }>;
  /** Historial del cliente en esta barbería. */
  customer: { completedVisits: number; noShows: number };
}

/**
 * Monto del adelanto (0 = no se pide). Función pura.
 *  - Cada servicio usa su excepción si la tiene; si no, la regla general.
 *  - percent y full se calculan por servicio; un monto fijo general se cobra una vez por reserva,
 *    y el fijo de una excepción, una vez por ese servicio.
 *  - Nunca supera el total. "Solo nuevos o que faltaron" exime a los clientes con historial limpio.
 */
export function computeDeposit(input: DepositInput): number {
  const { rule, items, customer } = input;
  if (rule.appliesTo === 'new_or_no_show' && customer.completedVisits > 0 && customer.noShows === 0)
    return 0;
  const total = items.reduce((n, i) => n + i.priceCents, 0);
  let amount = 0;
  let generalFixed = false;
  for (const it of items) {
    const r = it.override ?? rule;
    if (!r.required) continue;
    if (r.type === 'full') amount += it.priceCents;
    else if (r.type === 'percent')
      amount += Math.round((it.priceCents * Math.min(r.value, 100)) / 100);
    else if (it.override) amount += r.value;
    else generalFixed = true;
  }
  if (generalFixed && rule.required && rule.type === 'fixed') amount += rule.value;
  return Math.max(0, Math.min(amount, total));
}
