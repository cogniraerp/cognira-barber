import { z } from 'zod';

/** Una regla: porcentaje en puntos básicos (4000 = 40 %) o monto fijo por unidad (céntimos). */
export const RuleSchema = z
  .object({
    type: z.enum(['percent', 'fixed']),
    value: z.number().int().min(0).max(100_000_00),
  })
  .refine((r) => r.type !== 'percent' || r.value <= 10_000, {
    message: 'El porcentaje no puede pasar de 100 %',
    path: ['value'],
  });
export type Rule = z.infer<typeof RuleSchema>;

/** Comisión de un barbero (staff.commission). */
export const CommissionConfigSchema = z.object({
  service: RuleSchema.default({ type: 'percent', value: 0 }),
  product: RuleSchema.default({ type: 'percent', value: 0 }),
  /** Excepciones por servicio (p. ej. "Corte niño" fijo S/ 5). */
  overrides: z
    .array(z.object({ serviceId: z.uuid() }).and(RuleSchema))
    .max(100)
    .default([]),
});
export type CommissionConfig = z.infer<typeof CommissionConfigSchema>;

export function readConfig(raw: unknown): CommissionConfig {
  const r = CommissionConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : CommissionConfigSchema.parse({});
}

export type SaleForCommission = {
  discountCents: number;
  tipCents: number;
  tipStaffId: string | null;
  items: Array<{
    id: string;
    kind: 'service' | 'product';
    serviceId: string | null;
    staffId: string | null;
    name: string;
    quantity: number;
    totalCents: number;
  }>;
};

export type EntryDraft = {
  staffId: string;
  saleItemId: string | null;
  kind: 'service' | 'product' | 'tip';
  description: string;
  baseCents: number;
  rule: Rule;
  amountCents: number;
};

/**
 * Entradas de comisión de una venta.
 *  - Base de cada ítem = su total menos su parte del descuento general (proporcional al importe;
 *    el último ítem absorbe el redondeo para que la suma cuadre).
 *  - Regla: excepción del servicio → regla del barbero para servicios/productos.
 *  - Propina: 100 % a quien se indicó; si no, al barbero del primer servicio.
 *  - Ítems sin barbero o con comisión 0 no generan entrada.
 */
export function computeEntries(
  sale: SaleForCommission,
  configs: Map<string, CommissionConfig>,
): EntryDraft[] {
  const subtotal = sale.items.reduce((n, i) => n + i.totalCents, 0);
  let remaining = sale.discountCents;
  const out: EntryDraft[] = [];
  sale.items.forEach((it, idx) => {
    const share =
      idx === sale.items.length - 1
        ? remaining
        : subtotal
          ? Math.round((sale.discountCents * it.totalCents) / subtotal)
          : 0;
    remaining -= share;
    const base = Math.max(0, it.totalCents - share);
    if (!it.staffId) return;
    const cfg = configs.get(it.staffId) ?? readConfig({});
    const override =
      it.kind === 'service' ? cfg.overrides.find((o) => o.serviceId === it.serviceId) : undefined;
    const rule: Rule = override
      ? { type: override.type, value: override.value }
      : it.kind === 'service'
        ? cfg.service
        : cfg.product;
    const amount =
      rule.type === 'percent' ? Math.round((base * rule.value) / 10_000) : rule.value * it.quantity;
    if (amount <= 0) return;
    out.push({
      staffId: it.staffId,
      saleItemId: it.id,
      kind: it.kind,
      description: it.quantity > 1 ? `${it.quantity} × ${it.name}` : it.name,
      baseCents: base,
      rule,
      amountCents: amount,
    });
  });
  const tipStaff =
    sale.tipStaffId ?? sale.items.find((i) => i.kind === 'service' && i.staffId)?.staffId ?? null;
  if (sale.tipCents > 0 && tipStaff) {
    out.push({
      staffId: tipStaff,
      saleItemId: null,
      kind: 'tip',
      description: 'Propina',
      baseCents: sale.tipCents,
      rule: { type: 'percent', value: 10_000 },
      amountCents: sale.tipCents,
    });
  }
  return out;
}
