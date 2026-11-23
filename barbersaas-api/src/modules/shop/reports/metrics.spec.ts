import { describe, expect, it } from 'vitest';
import {
  byCatalog,
  byDay,
  byMethod,
  byStaff,
  computeKpis,
  netItemCents,
  previousPeriod,
  type AppointmentRow,
  type SaleRow,
} from './metrics';

const item = (over: Partial<SaleRow['items'][number]> = {}): SaleRow['items'][number] => ({
  kind: 'service',
  serviceId: 'corte',
  productId: null,
  staffId: 'carlos',
  name: 'Corte',
  quantity: 1,
  discountCents: 0,
  totalCents: 3000,
  ...over,
});
const sale = (over: Partial<SaleRow> = {}): SaleRow => ({
  createdAt: new Date('2026-11-02T15:00:00Z'), // 10:00 en Lima
  customerId: 'c1',
  discountCents: 0,
  tipCents: 0,
  totalCents: 3000,
  tipStaffId: null,
  items: [item()],
  payments: [{ method: 'cash', amountCents: 3000 }],
  ...over,
});
const appt = (status: string, staffId = 'carlos', min = 30): AppointmentRow => ({
  staffId,
  customerId: 'c1',
  status,
  startAt: new Date('2026-11-02T15:00:00Z'),
  endAt: new Date(Date.parse('2026-11-02T15:00:00Z') + min * 60_000),
});

// Corte 30 + Cera 25 = 55; descuento 5,50; propina 5 → total 54,50; ingresos 49,50.
const mixed = sale({
  discountCents: 550,
  tipCents: 500,
  totalCents: 5450,
  items: [
    item(),
    item({ kind: 'product', serviceId: null, productId: 'cera', name: 'Cera', totalCents: 2500 }),
  ],
  payments: [
    { method: 'cash', amountCents: 2000 },
    { method: 'yape', amountCents: 3450 },
  ],
});

describe('reportes: métricas', () => {
  it('prorratea el descuento general y el último ítem absorbe el redondeo', () => {
    expect(netItemCents(mixed)).toEqual([2700, 2250]);
    const odd = sale({
      discountCents: 100,
      items: [item({ totalCents: 1000 }), item({ totalCents: 1000 }), item({ totalCents: 1000 })],
    });
    const net = netItemCents(odd);
    expect(net.reduce((a, b) => a + b, 0)).toBe(2900);
  });

  it('KPIs: ingresos sin propina, ticket promedio, servicios/productos y citas', () => {
    const k = computeKpis(
      [mixed, sale()],
      [appt('completed'), appt('no_show'), appt('canceled')],
      600,
      {
        total: 2,
        new: 1,
      },
    );
    expect(k).toMatchObject({
      revenueCents: 4950 + 3000,
      salesCount: 2,
      avgTicketCents: 3975,
      tipCents: 500,
      discountCents: 550,
      serviceCents: 2700 + 3000,
      productCents: 2250,
      servicesCount: 2,
      productsCount: 1,
      appointments: 2,
      completed: 1,
      noShows: 1,
      canceled: 1,
      bookedMin: 60,
      scheduledMin: 600,
      newCustomers: 1,
      returningCustomers: 1,
    });
  });

  it('por día (hora local, días vacíos incluidos), por catálogo y por método', () => {
    const late = sale({ createdAt: new Date('2026-11-03T04:30:00Z') }); // 23:30 del 2 en Lima
    const d = byDay([mixed, late], '2026-11-01', '2026-11-03', 'America/Lima');
    expect(d.map((x) => [x.date, x.salesCount, x.revenueCents])).toEqual([
      ['2026-11-01', 0, 0],
      ['2026-11-02', 2, 7950],
      ['2026-11-03', 0, 0],
    ]);
    expect(byCatalog([mixed, sale()], 'service')).toEqual([
      { id: 'corte', name: 'Corte', quantity: 2, revenueCents: 5700 },
    ]);
    expect(byCatalog([mixed], 'product')[0]).toMatchObject({ id: 'cera', revenueCents: 2250 });
    expect(byMethod([mixed, sale()])).toEqual([
      { method: 'cash', count: 2, amountCents: 5000 },
      { method: 'yape', count: 1, amountCents: 3450 },
    ]);
  });

  it('por barbero: ventas, propina al del primer servicio, citas y ocupación', () => {
    const other = sale({
      items: [item({ staffId: 'luis' })],
      tipCents: 300,
      tipStaffId: 'luis',
      totalCents: 3300,
    });
    const rows = byStaff(
      [mixed, other],
      [appt('completed'), appt('no_show', 'luis', 45)],
      new Map([
        ['carlos', 480],
        ['ana', 480],
      ]),
    );
    const by = Object.fromEntries(rows.map((r) => [r.staffId, r]));
    expect(by.carlos).toMatchObject({
      revenueCents: 4950,
      servicesCount: 1,
      productsCount: 1,
      tipCents: 500,
      completed: 1,
      bookedMin: 30,
      scheduledMin: 480,
    });
    expect(by.luis).toMatchObject({
      revenueCents: 3000,
      tipCents: 300,
      noShows: 1,
      bookedMin: 45,
      scheduledMin: 0,
    });
    expect(by.ana).toMatchObject({ revenueCents: 0, scheduledMin: 480 });
  });

  it('período anterior de igual duración', () => {
    expect(previousPeriod('2026-11-01', '2026-11-30')).toEqual({
      from: '2026-10-02',
      to: '2026-10-31',
      days: 30,
    });
    expect(previousPeriod('2026-11-08', '2026-11-08')).toEqual({
      from: '2026-11-07',
      to: '2026-11-07',
      days: 1,
    });
  });
});
