/**
 * Ritmo de envío por número de WhatsApp vinculado por QR (Evolution, no oficial). Todo apunta a que
 * el número se comporte como una persona: pausas variables, topes, calentamiento y sin envíos de noche.
 * Sin I/O: el despachador le pasa los conteos.
 */
export interface PacingConfig {
  minGapSec: number;
  maxGapSec: number;
  hourlyCap: number;
  dailyCap: number;
  warmupDays: number;
  warmupDailyCap: number;
  /** "HH:MM-HH:MM" en hora de Lima (cruza la medianoche). */
  quietHours: string;
}

export interface PacingInput {
  now: Date;
  lastSentAt: Date | null;
  sentLastHour: number;
  sentToday: number;
  /** Cuándo se vinculó el número (para el calentamiento). */
  linkedAt: Date | null;
  cfg: PacingConfig;
  /** 0..1 (inyectable en pruebas). */
  rand?: () => number;
}

export type PacingDecision = { ok: true } | { ok: false; until: Date; reason: string };

const LIMA_MS = 5 * 3600_000; // UTC−5 todo el año
const DAY = 86_400_000;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
/** Minutos desde la medianoche de Lima. */
const limaMinutes = (d: Date) =>
  Math.floor(((((d.getTime() - LIMA_MS) % DAY) + DAY) % DAY) / 60_000);
/** Inicio (UTC) del día de Lima de `d`. */
const limaDayStart = (d: Date) =>
  new Date(Math.floor((d.getTime() - LIMA_MS) / DAY) * DAY + LIMA_MS);

export function parseQuietHours(s: string): { start: number; end: number } | null {
  const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(s.trim());
  return m ? { start: toMin(m[1]!), end: toMin(m[2]!) } : null;
}

/** ¿Estamos en el horario de descanso? Si sí, devuelve cuándo termina. */
export function quietUntil(now: Date, quietHours: string): Date | null {
  const q = parseQuietHours(quietHours);
  if (!q || q.start === q.end) return null;
  const min = limaMinutes(now);
  const inQuiet = q.start < q.end ? min >= q.start && min < q.end : min >= q.start || min < q.end;
  if (!inQuiet) return null;
  const dayStart = limaDayStart(now).getTime();
  const endToday = dayStart + q.end * 60_000;
  return new Date(endToday > now.getTime() ? endToday : endToday + DAY);
}

/** Inicio del día de Lima (para contar los "de hoy"). */
export const startOfLimaDay = limaDayStart;

export function decide(p: PacingInput): PacingDecision {
  const rand = p.rand ?? Math.random;
  const { cfg, now } = p;
  // Horario de descanso: sale por la mañana, con unos minutos de variación entre barberías.
  const quiet = quietUntil(now, cfg.quietHours);
  if (quiet)
    return {
      ok: false,
      until: new Date(quiet.getTime() + Math.floor(rand() * 20) * 60_000),
      reason: 'horario de descanso',
    };

  const warm = p.linkedAt !== null && now.getTime() - p.linkedAt.getTime() < cfg.warmupDays * DAY;
  const dailyCap = warm ? Math.min(cfg.warmupDailyCap, cfg.dailyCap) : cfg.dailyCap;
  if (p.sentToday >= dailyCap) {
    const tomorrow = limaDayStart(now).getTime() + DAY;
    const q = parseQuietHours(cfg.quietHours);
    const wake = tomorrow + (q ? q.end : 0) * 60_000 + Math.floor(rand() * 30) * 60_000;
    return {
      ok: false,
      until: new Date(wake),
      reason: warm ? 'tope diario (número recién vinculado)' : 'tope diario',
    };
  }
  if (p.sentLastHour >= cfg.hourlyCap)
    return {
      ok: false,
      until: new Date(now.getTime() + (10 + Math.floor(rand() * 10)) * 60_000),
      reason: 'tope por hora',
    };

  const gapMs = (cfg.minGapSec + rand() * Math.max(0, cfg.maxGapSec - cfg.minGapSec)) * 1000;
  if (p.lastSentAt && now.getTime() - p.lastSentAt.getTime() < gapMs)
    return {
      ok: false,
      until: new Date(p.lastSentAt.getTime() + gapMs),
      reason: 'pausa entre mensajes',
    };
  return { ok: true };
}
