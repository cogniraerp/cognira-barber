import { describe, expect, it } from 'vitest';
import { bucketDays, delta, fmtHours, fmtPct, ratio } from './report-utils';

describe('reportes: utilidades', () => {
  it('variación y porcentajes', () => {
    expect(delta(150, 100)).toBe(0.5);
    expect(delta(50, 100)).toBe(-0.5);
    expect(delta(10, 0)).toBeNull();
    expect(ratio(30, 240)).toBe(12.5);
    expect(ratio(1, 0)).toBeNull();
    expect(fmtPct(12.5, 1)).toBe('12.5 %');
    expect(fmtPct(null)).toBe('—');
  });
  it('horas de agenda', () => {
    expect(fmtHours(240)).toBe('4 h');
    expect(fmtHours(150)).toBe('2 h 30 min');
    expect(fmtHours(45)).toBe('45 min');
  });
  it('agrupa por mes si el rango es largo', () => {
    const day = (date: string, c: number) => ({ date, revenueCents: c, salesCount: 1, tipCents: 0 });
    expect(bucketDays([day('2026-11-01', 100)]).unit).toBe('day');
    const year = Array.from({ length: 90 }, (_, i) => day(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), 100));
    const b = bucketDays(year);
    expect(b.unit).toBe('month');
    expect(b.rows.map((r) => [r.date, r.salesCount])).toEqual([['2026-01-01', 31], ['2026-02-01', 28], ['2026-03-01', 31]]);
  });
});
