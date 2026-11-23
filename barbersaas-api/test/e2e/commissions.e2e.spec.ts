/** Fase 2 · paso 23: comisiones. */
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
let productId: string;
let barber: { token: string };

const api = (token: string, slug = A.slug) => {
  const h = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug);
  return {
    get: (u: string) => h(request(t.http).get(u)),
    post: (u: string, b?: object) => h(request(t.http).post(u)).send(b),
    put: (u: string, b?: object) => h(request(t.http).put(u)).send(b),
  };
};
const period = 'from=2020-01-01T00:00:00Z&to=2100-01-01T00:00:00Z';

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'com');
  ownerToken = await t.tokenFor(A.ownerUserId);
  const o = api(ownerToken);
  productId = (
    await o
      .post('/v1/shop/products', { name: 'Cera', priceCents: 2500, initialStock: 20 })
      .expect(201)
  ).body.id;
  await o.post('/v1/shop/cash/open', { openingCents: 50000 }).expect(201);
  // Usuario barbero vinculado al staff del fixture (para "Mis comisiones").
  const userId = randomUUID();
  const email = `barbero-${userId.slice(0, 8)}@test.pe`;
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Barbero', now())`,
    [userId, email],
  );
  const mid = randomUUID();
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [mid, A.barbershopId, userId],
  );
  await owner.query(`UPDATE staff SET membership_id = $1 WHERE id = $2`, [mid, A.staffId]);
  barber = { token: await t.tokenFor(userId, email) };
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

const sell = (body: object) => api(ownerToken).post('/v1/shop/sales', body).expect(201);

describe('comisiones', () => {
  it('regla del barbero: 40 % servicios, 10 % productos, excepción fija; validaciones', async () => {
    const o = api(ownerToken);
    expect((await o.get(`/v1/shop/commissions/config/${A.staffId}`).expect(200)).body).toEqual({
      service: { type: 'percent', value: 0 },
      product: { type: 'percent', value: 0 },
      overrides: [],
    });
    await o
      .put(`/v1/shop/commissions/config/${A.staffId}`, {
        service: { type: 'percent', value: 12000 },
      })
      .expect(400);
    await o
      .put(`/v1/shop/commissions/config/${A.staffId}`, {
        overrides: [{ serviceId: randomUUID(), type: 'fixed', value: 500 }],
      })
      .expect(404);
    const cfg = await o
      .put(`/v1/shop/commissions/config/${A.staffId}`, {
        service: { type: 'percent', value: 4000 },
        product: { type: 'percent', value: 1000 },
      })
      .expect(200);
    expect(cfg.body.service).toEqual({ type: 'percent', value: 4000 });
  });

  it('al cobrar se generan comisiones (con descuento prorrateado) y la propina', async () => {
    // Corte 30 + Cera 25 = 55; descuento 5,50 (10 %) → bases 27 y 22,50; propina 5.
    await sell({
      items: [
        { kind: 'service', serviceId: A.serviceId, staffId: A.staffId },
        { kind: 'product', productId, staffId: A.staffId },
      ],
      discountCents: 550,
      tipCents: 500,
      payments: [{ method: 'cash', amountCents: 5450 }],
    });
    const e = (
      await api(ownerToken).get(`/v1/shop/commissions/entries?staffId=${A.staffId}`).expect(200)
    ).body.items;
    expect(
      e
        .map((x: { kind: string; baseCents: number; amountCents: number }) => [
          x.kind,
          x.baseCents,
          x.amountCents,
        ])
        .sort(),
    ).toEqual([
      ['product', 2250, 225],
      ['service', 2700, 1080],
      ['tip', 500, 500],
    ]);
    expect(e[0]).toMatchObject({ saleCode: 'V-000001', status: 'pending', isReversal: false });
    const s = (await api(ownerToken).get(`/v1/shop/commissions/summary?${period}`).expect(200))
      .body;
    expect(s.rows[0]).toMatchObject({
      staff: { id: A.staffId },
      servicesCount: 1,
      productsCount: 1,
      commissionCents: 1305,
      tipCents: 500,
      earnedCents: 1805,
      pendingCents: 1805,
    });
  });

  it('cambiar la regla no altera lo ya ganado', async () => {
    await api(ownerToken)
      .put(`/v1/shop/commissions/config/${A.staffId}`, {
        service: { type: 'percent', value: 5000 },
      })
      .expect(200);
    const s = (await api(ownerToken).get(`/v1/shop/commissions/summary?${period}`).expect(200))
      .body;
    expect(s.rows[0].earnedCents).toBe(1805);
    await api(ownerToken)
      .put(`/v1/shop/commissions/config/${A.staffId}`, {
        service: { type: 'percent', value: 4000 },
        product: { type: 'percent', value: 1000 },
      })
      .expect(200);
  });

  it('liquidar: paga lo pendiente, registra el egreso en caja; no se paga dos veces', async () => {
    const o = api(ownerToken);
    const p = await o
      .post('/v1/shop/commissions/payouts', {
        staffId: A.staffId,
        method: 'cash',
        registerInCash: true,
        note: 'Semana 45',
      })
      .expect(201);
    expect(p.body).toMatchObject({
      totalCents: 1805,
      entriesCount: 3,
      method: 'cash',
      staff: { id: A.staffId },
    });
    await o.post('/v1/shop/commissions/payouts', { staffId: A.staffId }).expect(409);
    const cash = (await o.get('/v1/shop/cash/current').expect(200)).body.shift.movements;
    expect(
      cash.find(
        (m: { kind: string; concept: string }) =>
          m.kind === 'expense' && m.concept.startsWith('Pago de comisiones'),
      ),
    ).toMatchObject({ amountCents: 1805 });
    await o
      .post('/v1/shop/commissions/payouts', {
        staffId: A.staffId,
        method: 'yape',
        registerInCash: true,
      })
      .expect(409);
    const s = (await o.get(`/v1/shop/commissions/summary?${period}`).expect(200)).body;
    expect(s.rows[0]).toMatchObject({ pendingCents: 0, lastPayoutAt: expect.any(String) });
    expect((await o.get('/v1/shop/commissions/entries?status=paid').expect(200)).body.total).toBe(
      3,
    );
  });

  it('anular una venta ya liquidada: el reverso queda pendiente y se descuenta en la próxima', async () => {
    const o = api(ownerToken);
    const first = (await o.get('/v1/shop/sales?q=1').expect(200)).body.items[0];
    await o.post(`/v1/shop/sales/${first.id}/void`, { reason: 'Error' }).expect(200);
    let s = (await o.get(`/v1/shop/commissions/summary?${period}`).expect(200)).body.rows[0];
    expect(s.pendingCents).toBe(-1805);
    // Liquidar con saldo negativo no se permite.
    await o.post('/v1/shop/commissions/payouts', { staffId: A.staffId }).expect(409);
    // Una venta nueva compensa: 40 % de 30 = 12 → saldo −18,05 + 12 = −6,05.
    await sell({
      items: [{ kind: 'service', serviceId: A.serviceId, staffId: A.staffId }],
      payments: [{ method: 'cash', amountCents: 3000 }],
    });
    s = (await o.get(`/v1/shop/commissions/summary?${period}`).expect(200)).body.rows[0];
    expect(s.pendingCents).toBe(1200 - 1805);
    const reversals = (
      await o.get(`/v1/shop/commissions/entries?status=pending`).expect(200)
    ).body.items.filter((e: { isReversal: boolean }) => e.isReversal);
    expect(reversals).toHaveLength(3);
    expect(reversals[0].description).toMatch(/^Anulación: /);
  });

  it('el barbero ve solo lo suyo en "Mis comisiones" y no gestiona', async () => {
    const b = api(barber.token);
    const me = await b.get(`/v1/shop/commissions/me?${period}`).expect(200);
    expect(me.body.summary.staff.id).toBe(A.staffId);
    expect(me.body.entries.length).toBeGreaterThan(0);
    expect(me.body.payouts).toHaveLength(1);
    await b.get(`/v1/shop/commissions/summary?${period}`).expect(403);
    await b.post('/v1/shop/commissions/payouts', { staffId: A.staffId }).expect(403);
    await b.put(`/v1/shop/commissions/config/${A.staffId}`, {}).expect(403);
  });
});
