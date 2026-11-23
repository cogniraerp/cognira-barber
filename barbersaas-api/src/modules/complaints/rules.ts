/** Libro de Reclamaciones: plazos, código y textos (sin I/O). */

/** Días hábiles para responder (Código de Protección y Defensa del Consumidor, art. 24, mod. 2022). */
export const RESPONSE_BUSINESS_DAYS = 15;

const LIMA_OFFSET_MS = 5 * 3600_000; // UTC−5 todo el año

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher) como 'YYYY-MM-DD'. */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const shift = (ymd: string, days: number) =>
  new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Feriados nacionales de Perú (fijos + Jueves y Viernes Santo). */
export function peruHolidays(year: number): Set<string> {
  const fixed = [
    '01-01',
    '05-01',
    '06-07',
    '06-29',
    '07-23',
    '07-28',
    '07-29',
    '08-06',
    '08-30',
    '10-08',
    '11-01',
    '12-08',
    '12-09',
    '12-25',
  ];
  const e = easter(year);
  return new Set([...fixed.map((md) => `${year}-${md}`), shift(e, -3), shift(e, -2)]);
}

/**
 * Vencimiento: fin del día (hora de Lima) del día hábil N contado desde el día siguiente al
 * registro. No cuentan sábados, domingos ni feriados nacionales.
 */
export function dueDate(createdAt: Date, businessDays = RESPONSE_BUSINESS_DAYS): Date {
  let day = new Date(createdAt.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
  let left = businessDays;
  const cache = new Map<number, Set<string>>();
  while (left > 0) {
    day = shift(day, 1);
    const year = Number(day.slice(0, 4));
    if (!cache.has(year)) cache.set(year, peruHolidays(year));
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6 && !cache.get(year)!.has(day)) left--;
  }
  // 23:59:59.999 en Lima = 04:59:59.999 UTC del día siguiente.
  return new Date(Date.parse(`${day}T23:59:59.999Z`) + LIMA_OFFSET_MS);
}

/** Número de hoja: "N° 000042-2026". */
export function complaintCode(seq: number, createdAt: Date): string {
  const year = new Date(createdAt.getTime() - LIMA_OFFSET_MS).getUTCFullYear();
  return `N° ${String(seq).padStart(6, '0')}-${year}`;
}

export const KIND_LABEL = { reclamo: 'Reclamo', queja: 'Queja' } as const;

interface Sheet {
  code: string;
  kind: 'reclamo' | 'queja';
  providerName: string;
  providerTaxId: string | null;
  consumerName: string;
  itemDescription: string;
  detail: string;
  request: string;
  dueAt: Date;
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(d);

/** Copia para el consumidor (obligatoria, al registrar la hoja). */
export function receiptEmail(s: Sheet) {
  return {
    subject: `Libro de Reclamaciones · ${s.code} · ${s.providerName}`,
    body: [
      `Hola, ${s.consumerName}:`,
      '',
      `Registramos tu ${KIND_LABEL[s.kind].toLowerCase()} en el Libro de Reclamaciones de ${s.providerName}${s.providerTaxId ? ` (RUC ${s.providerTaxId})` : ''}.`,
      '',
      `Hoja: ${s.code}`,
      `Producto o servicio: ${s.itemDescription}`,
      `Detalle: ${s.detail}`,
      `Pedido: ${s.request}`,
      '',
      `Te responderemos a este correo a más tardar el ${fmtDate(s.dueAt)} (15 días hábiles).`,
      'La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.',
    ].join('\n'),
  };
}

/** Aviso al proveedor (dueños de la barbería o el correo legal de Cognira). */
export function providerEmail(s: Sheet, panelUrl: string) {
  return {
    subject: `Nuevo ${KIND_LABEL[s.kind].toLowerCase()} ${s.code}: responde antes del ${fmtDate(s.dueAt)}`,
    body: [
      `${s.consumerName} registró un ${KIND_LABEL[s.kind].toLowerCase()} en tu Libro de Reclamaciones.`,
      '',
      `Detalle: ${s.detail}`,
      `Pedido: ${s.request}`,
      '',
      `Tienes hasta el ${fmtDate(s.dueAt)} para responder (15 días hábiles). Respóndelo aquí: ${panelUrl}`,
    ].join('\n'),
  };
}

export function responseEmail(s: Sheet & { response: string }) {
  return {
    subject: `Respuesta a tu ${KIND_LABEL[s.kind].toLowerCase()} ${s.code} · ${s.providerName}`,
    body: [
      `Hola, ${s.consumerName}:`,
      '',
      `${s.providerName} respondió tu ${KIND_LABEL[s.kind].toLowerCase()} ${s.code}:`,
      '',
      s.response,
      '',
      'Si no estás conforme, puedes acudir al INDECOPI (www.gob.pe/indecopi).',
    ].join('\n'),
  };
}
