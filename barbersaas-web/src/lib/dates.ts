/** Utilidades de fecha en la zona de la barbería (la API trabaja en UTC). */

/** Offset "−05:00" de una zona en un instante. */
export function tzOffset(at: Date, timeZone: string): string {
  const part =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00';
}

/** Fecha local (YYYY-MM-DD) de un instante en una zona. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Inicio y fin del día local como ISO con offset, para consultar la agenda. */
export function dayRange(date: string, timeZone: string): { from: string; to: string } {
  const off = tzOffset(new Date(`${date}T12:00:00Z`), timeZone);
  return { from: `${date}T00:00:00${off}`, to: `${date}T23:59:59${off}` };
}

export function formatTime(iso: string, timeZone: string, locale = 'es-PE'): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

export function formatDateLong(date: Date, timeZone: string, locale = 'es-PE'): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(
    date,
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "Hora de pared": un Date cuyos componentes locales (del navegador) son la hora de la barbería.
 * react-big-calendar dibuja siempre en la zona del navegador; así la agenda muestra la hora de la
 * sede aunque quien la mire esté en otra zona. Volver al instante real con `fromWall`.
 */
export function toWall(at: string | Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const g = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
}

/** Fecha y hora de pared → ISO con el offset de la zona ("2027-03-01T10:30:00-05:00"). */
export function fromWall(wall: Date, timeZone: string): string {
  const date = wallDate(wall);
  const time = `${pad(wall.getHours())}:${pad(wall.getMinutes())}:00`;
  // El offset depende del instante (horario de verano): se estima y se corrige una vez.
  const guess = tzOffset(new Date(`${date}T${time}Z`), timeZone);
  const off = tzOffset(new Date(`${date}T${time}${guess}`), timeZone);
  return `${date}T${time}${off}`;
}

/** YYYY-MM-DD de un Date de pared. */
export function wallDate(wall: Date): string {
  return `${wall.getFullYear()}-${pad(wall.getMonth() + 1)}-${pad(wall.getDate())}`;
}

/** HH:mm de un Date de pared. */
export function wallTime(wall: Date): string {
  return `${pad(wall.getHours())}:${pad(wall.getMinutes())}`;
}

/** "2027-03-01" + "10:30" → Date de pared. */
export function parseWall(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y!, m! - 1, d!, h ?? 0, mi ?? 0);
}

/** "13:15" en la zona dada (columnas angostas: agenda, Mi día). */
export function formatTime24(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}
