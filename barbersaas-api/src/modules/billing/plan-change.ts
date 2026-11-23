const DAY = 86_400_000;

export type Interval = 'month' | 'year';
export interface PlanPrice {
  priceMonthlyCents: number;
  priceYearlyCents: number;
}

/** Precio mensual equivalente (para comparar planes e intervalos), con el descuento aplicado. */
export function monthlyEquivalent(
  plan: PlanPrice,
  interval: Interval,
  discountPercent: number,
): number {
  const list = interval === 'year' ? plan.priceYearlyCents / 12 : plan.priceMonthlyCents;
  return (list * (100 - discountPercent)) / 100;
}

/**
 * Qué pasa con un cambio de plan (función pura):
 *  - mismo plan e intervalo → nada;
 *  - plan de mayor precio → se sube YA (con prorrateo); el cambio de intervalo, si lo hay, se programa;
 *  - plan menor o solo cambio de intervalo → se programa para el fin del periodo.
 */
export function classifyChange(
  cur: { planId: string; plan: PlanPrice; interval: Interval },
  target: { planId: string; plan: PlanPrice; interval: Interval },
): { kind: 'none' | 'upgrade' | 'scheduled'; scheduleInterval: boolean } {
  const samePlan = cur.planId === target.planId;
  const intervalChanges = cur.interval !== target.interval;
  if (samePlan && !intervalChanges) return { kind: 'none', scheduleInterval: false };
  if (
    !samePlan &&
    monthlyEquivalent(target.plan, cur.interval, 0) > monthlyEquivalent(cur.plan, cur.interval, 0)
  )
    return { kind: 'upgrade', scheduleInterval: intervalChanges };
  return { kind: 'scheduled', scheduleInterval: intervalChanges };
}

/**
 * Diferencia a cobrar al subir de plan a mitad de periodo: (precio nuevo − actual) en el intervalo
 * actual × fracción del periodo que queda. Menos de S/ 1.00 no se factura.
 */
export function prorate(input: {
  from: PlanPrice;
  to: PlanPrice;
  interval: Interval;
  discountPercent: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): number {
  const price = (p: PlanPrice) =>
    input.interval === 'year' ? p.priceYearlyCents : p.priceMonthlyCents;
  const total = input.periodEnd.getTime() - input.periodStart.getTime();
  const left = Math.max(0, input.periodEnd.getTime() - input.now.getTime());
  if (total <= 0 || left <= 0) return 0;
  const diff = ((price(input.to) - price(input.from)) * (100 - input.discountPercent)) / 100;
  const cents = Math.round((diff * left) / total);
  return cents >= 100 ? cents : 0;
}

/** Lo que sobra para bajar a un plan (null = ilimitado). */
export function limitBlockers(
  limits: { staff: number | null; locations: number | null; services: number | null },
  usage: { staff: number; locations: number; services: number },
): Array<{ key: 'staff' | 'locations' | 'services'; max: number; current: number }> {
  return (['staff', 'locations', 'services'] as const)
    .filter((k) => limits[k] !== null && usage[k] > limits[k])
    .map((k) => ({ key: k, max: limits[k]!, current: usage[k] }));
}

export const daysLeft = (end: Date, now: Date) =>
  Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY));
