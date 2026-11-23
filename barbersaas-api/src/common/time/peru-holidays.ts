/**
 * Feriados nacionales de Perú (no laborables por ley, Ley 31579 y anteriores).
 * Incluye los movibles de Semana Santa. NO incluye días no laborables que el gobierno
 * declara año a año por decreto: esos se agregan manualmente.
 */
export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

const FIXED: Array<{ md: string; name: string; since?: number }> = [
  { md: '01-01', name: 'Año Nuevo' },
  { md: '05-01', name: 'Día del Trabajo' },
  { md: '06-07', name: 'Batalla de Arica y Día de la Bandera', since: 2024 },
  { md: '06-29', name: 'San Pedro y San Pablo' },
  { md: '07-23', name: 'Día de la Fuerza Aérea del Perú', since: 2024 },
  { md: '07-28', name: 'Fiestas Patrias' },
  { md: '07-29', name: 'Fiestas Patrias' },
  { md: '08-06', name: 'Batalla de Junín', since: 2022 },
  { md: '08-30', name: 'Santa Rosa de Lima' },
  { md: '10-08', name: 'Combate de Angamos' },
  { md: '11-01', name: 'Día de Todos los Santos' },
  { md: '12-08', name: 'Inmaculada Concepción' },
  { md: '12-09', name: 'Batalla de Ayacucho', since: 2022 },
  { md: '12-25', name: 'Navidad' },
];

export function peruHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const shift = (days: number) =>
    new Date(easter.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const list: Holiday[] = [
    ...FIXED.filter((f) => !f.since || year >= f.since).map((f) => ({
      date: `${year}-${f.md}`,
      name: f.name,
    })),
    { date: shift(-3), name: 'Jueves Santo' },
    { date: shift(-2), name: 'Viernes Santo' },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Domingo de Pascua (algoritmo gregoriano anónimo / Meeus). */
export function easterSunday(year: number): Date {
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
  return new Date(Date.UTC(year, month - 1, day));
}
