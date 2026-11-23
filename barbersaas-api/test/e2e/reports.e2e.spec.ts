/** Fase 2 · paso 24: reportes. */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let ownerToken: string;
let barberToken: string;
let productId: string;

const api = (token: string) => {
  const h = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', A.slug);
  return {
    get: (u: string) => h(request(t.http).get(u)),
    post: (u: string, b?: object) => h(request(t.http).post(u)).send(b),
  };
};
/** Hoy en Lima (las ventas se registran ahora). */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'rep');
  ownerToken = await t.tokenFor(A.ownerUserId);
  const o = api(ownerToken);
  productId = (
    await o
      .post('/v1/shop/products', { name: 'Cera', priceCents: 2500, initialStock: 20 })
      .expect(201)
  ).body.id;
  await o.post('/v1/shop/cash/open', { openingCents: 0 }).expect(201);
  const userId = randomUUID();
  const email = `barbero-${userId.slice(0, 8)}@test.pe`;
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Barbero', now())`,
    [userId, email],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [randomUUID(), A.barbershopId, userId],
  );
  barberToken = await t.tokenFor(userId, email);

  // Venta 1: corte + cera, descuento 5,50, propina 5, pago mixto → ingresos 49,50.
  await o
    .post('/v1/shop/sales', {
      customerId: A.customerId,
      items: [
        { kind: 'service', serviceId: A.serviceId, staffId: A.staffId },
        { kind: 'product', productId, staffId: A.staffId },
      ],
      discountCents: 550,
      tipCents: 500,
      payments: [
        { method: 'cash', amountCents: 2000 },
        { method: 'yape', amountCents: 3450 },
      ],
    })
    .expect(201);
  // Venta 2: corte en Yape (30). Venta 3: anulada (no cuenta).
  await o
    .post('/v1/shop/sales', {
      items: [{ kind: 'service', serviceId: A.serviceId, staffId: A.staffId }],
      payments: [{ method: 'yape', amountCents: 3000 }],
    })
    .expect(201);
  const voided = await o
    .post('/v1/shop/sales', {
      items: [{ kind: 'product', productId, quantity: 2 }],
      payments: [{ method: 'cash', amountCents: 5000 }],
    })
    .expect(201);
  await o.post(`/v1/shop/sales/${voided.body.id}/void`, { reason: 'Error' }).expect(200);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('reportes', () => {
  it('KPIs del día: ingresos sin propina ni anuladas, ticket promedio, clientes nuevos', async () => {
    const r = (
      await api(ownerToken).get(`/v1/shop/reports/overview?from=${today}&to=${today}`).expect(200)
    ).body;
    expect(r.period).toEqual({ from: today, to: today, days: 1 });
    expect(r.kpis).toMatchObject({
      revenueCents: 4950 + 3000,
      salesCount: 2,
      avgTicketCents: 3975,
      tipCents: 500,
      discountCents: 550,
      serviceCents: 2700 + 3000,
      productCents: 2250,
      servicesCount: 2,
      productsCount: 1,
      customers: 1,
      newCustomers: 1,
    });
    expect(r.previousKpis).toMatchObject({ revenueCents: 0, salesCount: 0 });
    expect(r.byDay).toEqual([{ date: today, revenueCents: 7950, salesCount: 2, tipCents: 500 }]);
    expect(r.byMethod).toEqual([
      { method: 'yape', count: 2, amountCents: 6450 },
      { method: 'cash', count: 1, amountCents: 2000 },
    ]);
    expect(r.byService).toEqual([
      { id: A.serviceId, name: 'Corte', quantity: 2, revenueCents: 5700 },
    ]);
    expect(r.byProduct).toEqual([{ id: productId, name: 'Cera', quantity: 1, revenueCents: 2250 }]);
    expect(r.byStaff[0]).toMatchObject({
      staff: { id: A.staffId },
      revenueCents: 7950,
      servicesCount: 2,
      productsCount: 1,
      tipCents: 500,
    });
  });

  it('ocupación y citas: horario de la sede (lunes 9–13) vs. minutos reservados', async () => {
    const r = (
      await api(ownerToken)
        .get('/v1/shop/reports/overview?from=2027-03-01&to=2027-03-07')
        .expect(200)
    ).body;
    expect(r.kpis).toMatchObject({ appointments: 1, bookedMin: 30, scheduledMin: 240 });
    expect(r.previous).toEqual({ from: '2027-02-22', to: '2027-02-28' });
    expect(r.byStaff[0]).toMatchObject({ bookedMin: 30, scheduledMin: 240, appointments: 1 });
    expect(r.byDay).toHaveLength(7);
  });

  it('valida el rango y la sede', async () => {
    const o = api(ownerToken);
    await o.get('/v1/shop/reports/overview?from=2026-11-08&to=2026-11-01').expect(400);
    await o.get('/v1/shop/reports/overview?from=2025-01-01&to=2026-12-31').expect(400);
    await o
      .get(`/v1/shop/reports/overview?from=${today}&to=${today}&locationId=${randomUUID()}`)
      .expect(400);
    const r = await o
      .get(`/v1/shop/reports/overview?from=${today}&to=${today}&locationId=${A.locationId}`)
      .expect(200);
    expect(r.body.kpis.salesCount).toBe(2);
  });

  it('exporta CSV por sección', async () => {
    const r = await api(ownerToken)
      .get(`/v1/shop/reports/export.csv?section=staff&from=${today}&to=${today}`)
      .expect(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toContain(`reporte-staff-${today}_${today}.csv`);
    const lines = r.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toMatch(/^barbero,ingresos,/);
    expect(lines[1]).toMatch(/^Barbero,79\.50,2,57\.00,1,22\.50,5\.00,/);
    const m = await api(ownerToken)
      .get(`/v1/shop/reports/export.csv?section=methods&from=${today}&to=${today}`)
      .expect(200);
    expect(m.text).toContain('yape,2,64.50');
    await api(ownerToken)
      .get(`/v1/shop/reports/export.csv?section=otra&from=${today}&to=${today}`)
      .expect(400);
  });

  it('el barbero no ve reportes', async () => {
    await api(barberToken).get(`/v1/shop/reports/overview?from=${today}&to=${today}`).expect(403);
  });
});
