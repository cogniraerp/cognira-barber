import { describe, expect, it } from 'vitest';
import { classifyChange, limitBlockers, monthlyEquivalent, prorate } from './plan-change';

const basico = { priceMonthlyCents: 4900, priceYearlyCents: 49000 };
const pro = { priceMonthlyCents: 9900, priceYearlyCents: 99000 };

describe('cambio de plan', () => {
  it('precio mensual equivalente con descuento', () => {
    expect(monthlyEquivalent(pro, 'month', 0)).toBe(9900);
    expect(monthlyEquivalent(pro, 'year', 0)).toBe(8250);
    expect(monthlyEquivalent(pro, 'month', 10)).toBe(8910);
  });

  it('clasifica: subir ya, bajar o cambiar de intervalo al fin del periodo', () => {
    const cur = { planId: 'b', plan: basico, interval: 'month' as const };
    expect(classifyChange(cur, { planId: 'b', plan: basico, interval: 'month' }).kind).toBe('none');
    expect(classifyChange(cur, { planId: 'p', plan: pro, interval: 'month' })).toEqual({
      kind: 'upgrade',
      scheduleInterval: false,
    });
    expect(classifyChange(cur, { planId: 'p', plan: pro, interval: 'year' })).toEqual({
      kind: 'upgrade',
      scheduleInterval: true,
    });
    expect(
      classifyChange(
        { planId: 'p', plan: pro, interval: 'month' },
        { planId: 'b', plan: basico, interval: 'month' },
      ).kind,
    ).toBe('scheduled');
    expect(classifyChange(cur, { planId: 'b', plan: basico, interval: 'year' })).toEqual({
      kind: 'scheduled',
      scheduleInterval: true,
    });
  });

  it('prorratea la diferencia por lo que queda del periodo (mínimo S/ 1.00)', () => {
    const periodStart = new Date('2026-11-01T05:00:00Z');
    const periodEnd = new Date('2026-12-01T05:00:00Z');
    const mid = new Date('2026-11-16T05:00:00Z'); // queda la mitad
    expect(
      prorate({
        from: basico,
        to: pro,
        interval: 'month',
        discountPercent: 0,
        periodStart,
        periodEnd,
        now: mid,
      }),
    ).toBe(2500);
    expect(
      prorate({
        from: basico,
        to: pro,
        interval: 'month',
        discountPercent: 20,
        periodStart,
        periodEnd,
        now: mid,
      }),
    ).toBe(2000);
    expect(
      prorate({
        from: basico,
        to: pro,
        interval: 'month',
        discountPercent: 0,
        periodStart,
        periodEnd,
        now: new Date('2026-11-30T23:00:00Z'),
      }),
    ).toBe(0);
    expect(
      prorate({
        from: basico,
        to: pro,
        interval: 'month',
        discountPercent: 0,
        periodStart,
        periodEnd,
        now: periodEnd,
      }),
    ).toBe(0);
  });

  it('lo que sobra para bajar de plan', () => {
    expect(
      limitBlockers(
        { staff: 3, locations: 1, services: null },
        { staff: 5, locations: 1, services: 80 },
      ),
    ).toEqual([{ key: 'staff', max: 3, current: 5 }]);
    expect(
      limitBlockers(
        { staff: null, locations: null, services: null },
        { staff: 50, locations: 9, services: 9 },
      ),
    ).toEqual([]);
  });
});
