/** "hoy", "hace 3 días", "en 2 semanas"… (null si no hay fecha). */
export function relativeDays(iso: string | null | undefined, locale = 'es-PE', now = Date.now()): string | null {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - now) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(days);
  if (abs < 14) return rtf.format(days, 'day');
  if (abs < 60) return rtf.format(Math.round(days / 7), 'week');
  if (abs < 365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

/** Fecha corta en la zona de la barbería: "9 nov 2026". */
export function shortDate(iso: string, timeZone: string, locale = 'es-PE'): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));
}

/** Cumpleaños (YYYY-MM-DD) → "14 de marzo" y si cae en los próximos 7 días. */
export function birthdayInfo(day: string, locale = 'es-PE', now = new Date()): { label: string; soon: boolean } {
  const [, m, d] = day.split('-').map(Number);
  const label = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m! - 1, d!)));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let next = Date.UTC(now.getFullYear(), m! - 1, d!);
  if (next < today) next = Date.UTC(now.getFullYear() + 1, m! - 1, d!);
  return { label, soon: (next - today) / 86_400_000 <= 7 };
}

/** CSV de ejemplo para importar (mismas columnas que reconoce la API). */
export const IMPORT_TEMPLATE =
  '﻿nombre,telefono,email,cumpleanos,etiquetas,notas\n' +
  'Juan Pérez,987654321,juan@correo.com,1990-03-14,vip;frecuente,Degradado bajo\n' +
  'Ana Torres,912345678,,,,\n';
