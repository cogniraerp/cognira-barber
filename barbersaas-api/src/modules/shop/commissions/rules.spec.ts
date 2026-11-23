import { describe, expect, it } from 'vitest';
import { computeEntries, readConfig, type SaleForCommission } from './rules';

const carlos = '11111111-1111-4111-8111-111111111111';
const diego = '22222222-2222-4222-8222-222222222222';
const corte = '33333333-3333-4333-8333-333333333333';
const nino = '44444444-4444-4444-8444-444444444444';

const configs = new Map([
  [
    carlos,
    readConfig({
      service: { type: 'percent', value: 4000 },
      product: { type: 'percent', value: 1000 },
      overrides: [{ serviceId: nino, type: 'fixed', value: 500 }],
    }),
  ],
  [diego, readConfig({ service: { type: 'fixed', value: 1200 } })],
]);
const sale = (p: Partial<SaleForCommission>): SaleForCommission => ({
  discountCents: 0,
  tipCents: 0,
  tipStaffId: null,
  items: [],
  ...p,
});

describe('comisiones', () => {
  it('porcentaje sobre servicios y productos, fijo por unidad, excepción por servicio', () => {
    const e = computeEntries(
      sale({
        items: [
          {
            id: 'a',
            kind: 'service',
            serviceId: corte,
            staffId: carlos,
            name: 'Corte',
            quantity: 1,
            totalCents: 3500,
          },
          {
            id: 'b',
            kind: 'product',
            serviceId: null,
            staffId: carlos,
            name: 'Cera',
            quantity: 2,
            totalCents: 5000,
          },
          {
            id: 'c',
            kind: 'service',
            serviceId: nino,
            staffId: carlos,
            name: 'Corte niño',
            quantity: 1,
            totalCents: 2500,
          },
          {
            id: 'd',
            kind: 'service',
            serviceId: corte,
            staffId: diego,
            name: 'Corte',
            quantity: 1,
            totalCents: 3500,
          },
        ],
      }),
      configs,
    );
    expect(e.map((x) => [x.saleItemId, x.amountCents])).toEqual([
      ['a', 1400], // 40 % de 35
      ['b', 500], // 10 % de 50
      ['c', 500], // fijo S/ 5 (excepción)
      ['d', 1200], // fijo S/ 12 de Diego
    ]);
    expect(e[1]!.description).toBe('2 × Cera');
  });

  it('el descuento general se reparte proporcional y el último ítem absorbe el redondeo', () => {
    const e = computeEntries(
      sale({
        discountCents: 1000,
        items: [
          {
            id: 'a',
            kind: 'service',
            serviceId: corte,
            staffId: carlos,
            name: 'Corte',
            quantity: 1,
            totalCents: 3333,
          },
          {
            id: 'b',
            kind: 'service',
            serviceId: corte,
            staffId: carlos,
            name: 'Corte',
            quantity: 1,
            totalCents: 6667,
          },
        ],
      }),
      configs,
    );
    expect(e.map((x) => x.baseCents)).toEqual([3000, 6000]);
    expect(e.reduce((n, x) => n + x.baseCents, 0)).toBe(9000);
  });

  it('propina 100 % a quien se indica, o al barbero del primer servicio; sin barbero no hay comisión', () => {
    const items: SaleForCommission['items'] = [
      {
        id: 'a',
        kind: 'service',
        serviceId: corte,
        staffId: diego,
        name: 'Corte',
        quantity: 1,
        totalCents: 3500,
      },
      {
        id: 'b',
        kind: 'product',
        serviceId: null,
        staffId: null,
        name: 'Cera',
        quantity: 1,
        totalCents: 2500,
      },
    ];
    const auto = computeEntries(sale({ items, tipCents: 500 }), configs);
    expect(auto.find((x) => x.kind === 'tip')).toMatchObject({ staffId: diego, amountCents: 500 });
    expect(auto.some((x) => x.saleItemId === 'b')).toBe(false);
    const explicit = computeEntries(sale({ items, tipCents: 500, tipStaffId: carlos }), configs);
    expect(explicit.find((x) => x.kind === 'tip')!.staffId).toBe(carlos);
  });

  it('configuración inválida o vacía = 0 % (nunca rompe el cobro)', () => {
    expect(readConfig({ service: { type: 'percent', value: 99999 } })).toMatchObject({
      service: { value: 0 },
    });
    expect(
      computeEntries(
        sale({
          items: [
            {
              id: 'a',
              kind: 'service',
              serviceId: corte,
              staffId: 'otro',
              name: 'Corte',
              quantity: 1,
              totalCents: 3500,
            },
          ],
        }),
        configs,
      ),
    ).toEqual([]);
  });
});
