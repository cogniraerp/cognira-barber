import { formatMoney } from '@/lib/utils';

export type Rule = { type: 'percent' | 'fixed'; value: number };
export type Config = { service: Rule; product: Rule; overrides: Array<Rule & { serviceId: string }> };

/** 4000 → "40 %"; fijo 500 → "S/ 5.00 c/u". */
export const ruleLabel = (r: Rule) => (r.type === 'percent' ? `${(r.value / 100).toLocaleString('es-PE')} %` : `${formatMoney(r.value)} c/u`);

export function configSummary(c: Config): string {
  const parts = [`${ruleLabel(c.service)} servicios`, `${ruleLabel(c.product)} productos`];
  if (c.overrides.length) parts.push(`${c.overrides.length} excepción${c.overrides.length === 1 ? '' : 'es'}`);
  return parts.join(' · ');
}

export const isZero = (c: Config) => c.service.value === 0 && c.product.value === 0 && c.overrides.length === 0;
