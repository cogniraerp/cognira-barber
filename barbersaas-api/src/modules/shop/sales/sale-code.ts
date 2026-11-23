/** Número de venta legible: 123 → "V-000123". */
export const saleCode = (n: number) => `V-${String(n).padStart(6, '0')}`;
