/**
 * Normaliza teléfonos a E.164. Por defecto Perú (+51):
 *   "987 654 321" → "+51987654321" · "51987654321" → "+51987654321" · "+1 (305) 555-0100" → "+13055550100"
 * Devuelve null si no parece un número válido.
 */
const COUNTRY_CODES: Record<string, string> = {
  PE: '51',
  CO: '57',
  CL: '56',
  MX: '52',
  EC: '593',
  AR: '54',
  BO: '591',
  US: '1',
};

export function normalizePhone(raw: string, country = 'PE'): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  let e164: string;
  if (trimmed.startsWith('+')) e164 = `+${digits}`;
  else if (trimmed.startsWith('00')) e164 = `+${digits.slice(2)}`;
  else {
    const cc = COUNTRY_CODES[country] ?? '51';
    // Perú: móviles de 9 dígitos que empiezan por 9; si ya trae el 51 delante, no se duplica.
    if (cc === '51' && digits.length === 11 && digits.startsWith('51')) e164 = `+${digits}`;
    else e164 = `+${cc}${digits.replace(/^0+/, '')}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}
