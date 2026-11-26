import { describe, expect, it } from 'vitest';
import { decide, quietUntil, type PacingConfig } from './evolution-pacing';

const cfg: PacingConfig = {
  minGapSec: 8,
  maxGapSec: 18,
  hourlyCap: 40,
  dailyCap: 250,
  warmupDays: 3,
  warmupDailyCap: 60,
  quietHours: '21:30-07:30',
};
// 26 nov 2026, 10:00 en Lima = 15:00 UTC
const am10 = new Date('2026-11-26T15:00:00Z');
const base = {
  now: am10,
  lastSentAt: null,
  sentLastHour: 0,
  sentToday: 0,
  linkedAt: new Date('2026-11-01T00:00:00Z'),
  cfg,
  rand: () => 0.5,
};

describe('ritmo de envío por número (anti-bloqueo)', () => {
  it('a media mañana y sin envíos previos: sale', () => {
    expect(decide(base)).toEqual({ ok: true });
  });

  it('pausa variable entre mensajes del mismo número (8 a 18 s)', () => {
    const r = decide({ ...base, lastSentAt: new Date(am10.getTime() - 5_000) });
    expect(r).toMatchObject({ ok: false, reason: 'pausa entre mensajes' });
    // rand 0.5 → 13 s después del último
    expect((r as { until: Date }).until.getTime() - (am10.getTime() - 5_000)).toBe(13_000);
    expect(decide({ ...base, lastSentAt: new Date(am10.getTime() - 20_000) })).toEqual({
      ok: true,
    });
  });

  it('horario de descanso: de noche no sale y se reprograma a las 07:30 (+ variación)', () => {
    const night = new Date('2026-11-27T04:00:00Z'); // 23:00 Lima del 26
    expect(quietUntil(night, cfg.quietHours)?.toISOString()).toBe('2026-11-27T12:30:00.000Z'); // 07:30 Lima del 27
    const early = new Date('2026-11-26T11:00:00Z'); // 06:00 Lima
    expect(quietUntil(early, cfg.quietHours)?.toISOString()).toBe('2026-11-26T12:30:00.000Z');
    expect(quietUntil(am10, cfg.quietHours)).toBeNull();
    const r = decide({ ...base, now: night, rand: () => 0 });
    expect(r).toMatchObject({
      ok: false,
      reason: 'horario de descanso',
      until: new Date('2026-11-27T12:30:00.000Z'),
    });
  });

  it('topes por hora y por día', () => {
    expect(decide({ ...base, sentLastHour: 40 })).toMatchObject({
      ok: false,
      reason: 'tope por hora',
    });
    const r = decide({ ...base, sentToday: 250, rand: () => 0 });
    expect(r).toMatchObject({
      ok: false,
      reason: 'tope diario',
      until: new Date('2026-11-27T12:30:00.000Z'),
    });
  });

  it('calentamiento: los primeros días el tope diario es menor', () => {
    const linkedYesterday = new Date(am10.getTime() - 86_400_000);
    expect(decide({ ...base, linkedAt: linkedYesterday, sentToday: 60 })).toMatchObject({
      ok: false,
      reason: 'tope diario (número recién vinculado)',
    });
    expect(decide({ ...base, sentToday: 60 })).toEqual({ ok: true });
  });
});
