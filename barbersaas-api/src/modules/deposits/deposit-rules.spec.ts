import { describe, expect, it } from 'vitest';
import { computeDeposit, type DepositInput } from './deposit-rules';

const rule = (over: Partial<DepositInput['rule']> = {}): DepositInput['rule'] => ({
  required: true,
  type: 'percent',
  value: 50,
  appliesTo: 'all',
  ...over,
});
const item = (priceCents: number, override: DepositInput['items'][number]['override'] = null) => ({
  priceCents,
  override,
});
const newbie = { completedVisits: 0, noShows: 0 };
const regular = { completedVisits: 4, noShows: 0 };

describe('adelantos: monto', () => {
  it('porcentaje, total y fijo (una vez por reserva) sin pasar del total', () => {
    expect(
      computeDeposit({ rule: rule(), items: [item(3500), item(2000)], customer: newbie }),
    ).toBe(2750);
    expect(
      computeDeposit({ rule: rule({ type: 'full' }), items: [item(3500)], customer: newbie }),
    ).toBe(3500);
    expect(
      computeDeposit({
        rule: rule({ type: 'fixed', value: 1000 }),
        items: [item(3500), item(2000)],
        customer: newbie,
      }),
    ).toBe(1000);
    expect(
      computeDeposit({
        rule: rule({ type: 'fixed', value: 9000 }),
        items: [item(3500)],
        customer: newbie,
      }),
    ).toBe(3500);
    expect(
      computeDeposit({ rule: rule({ required: false }), items: [item(3500)], customer: newbie }),
    ).toBe(0);
  });

  it('excepciones por servicio: eximir, exigir o cambiar el tipo', () => {
    const exempt = { required: false, type: 'percent' as const, value: 0 };
    const fixed = { required: true, type: 'fixed' as const, value: 1500 };
    // Corte con la regla (50 %) + barba exenta.
    expect(
      computeDeposit({ rule: rule(), items: [item(3500), item(2000, exempt)], customer: newbie }),
    ).toBe(1750);
    // Sin regla general, pero el servicio "Color" exige S/ 15.
    expect(
      computeDeposit({
        rule: rule({ required: false }),
        items: [item(3500), item(8000, fixed)],
        customer: newbie,
      }),
    ).toBe(1500);
  });

  it('"solo nuevos o que faltaron" exime a los clientes con buen historial', () => {
    const r = rule({ appliesTo: 'new_or_no_show' });
    expect(computeDeposit({ rule: r, items: [item(3500)], customer: newbie })).toBe(1750);
    expect(computeDeposit({ rule: r, items: [item(3500)], customer: regular })).toBe(0);
    expect(
      computeDeposit({
        rule: r,
        items: [item(3500)],
        customer: { completedVisits: 4, noShows: 1 },
      }),
    ).toBe(1750);
  });
});
