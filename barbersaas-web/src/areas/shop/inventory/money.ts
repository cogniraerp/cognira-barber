/** "35", "35.5", "35,50" → 3550 céntimos (null si no es un monto válido). */
export function parseMoney(text: string): number | null {
  const v = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

/** 3550 → "35.50" (para inputs). */
export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

/** Margen sobre el precio: (precio − costo) / precio. */
export function margin(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 100);
}
