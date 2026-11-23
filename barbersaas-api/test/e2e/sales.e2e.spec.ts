/** Fase 2 · paso 22: punto de venta. */
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
let B: TenantFixture;
let ownerToken: string;
let productId: string;

const api = (token: string, slug = A.slug) => {
  const h = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug);
  return {
    get: (u: string) => h(request(t.http).get(u)),
    post: (u: string, b?: object) => h(request(t.http).post(u)).send(b),
  };
};

async function addMember(shop: TenantFixture, role: 'admin' | 'receptionist' | 'barber') {
  const userId = randomUUID();
  const email = `${role}-${userId.slice(0, 8)}@test.pe`;
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, $3, now())`,
    [userId, email, role],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, $4, 'active', now())`,
    [randomUUID(), shop.barbershopId, userId, role],
  );
  return { token: await t.tokenFor(userId, email) };
}

const stockOf = async (id: string) =>
  (await api(ownerToken).get(`/v1/shop/products/${id}`).expect(200)).body.stock as number;

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'pos');
  B = await createTenant(owner, 'posb');
  ownerToken = await t.tokenFor(A.ownerUserId);
  productId = (
    await api(ownerToken)
      .post('/v1/shop/products', { name: 'Cera', priceCents: 2500, initialStock: 5 })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('punto de venta', () => {
  it('sin caja abierta no se cobra', async () => {
    const r = await api(ownerToken)
      .post('/v1/shop/sales', {
        items: [{ kind: 'product', productId }],
        payments: [{ method: 'cash', amountCents: 2500 }],
      })
      .expect(409);
    expect(r.body.cashClosed).toBe(true);
    await api(ownerToken).post('/v1/shop/cash/open', { openingCents: 10000 }).expect(201);
  });

  it('venta con servicio + productos, descuento, propina y pago mixto', async () => {
    const o = api(ownerToken);
    const body = {
      customerId: A.customerId,
      items: [
        { kind: 'service', serviceId: A.serviceId, staffId: A.staffId },
        { kind: 'product', productId, quantity: 2, staffId: A.staffId },
      ],
      discountCents: 500,
      tipCents: 1000,
      tipStaffId: A.staffId,
      payments: [
        { method: 'cash', amountCents: 3000 },
        { method: 'yape', amountCents: 5500, reference: 'OP 123' },
      ],
    };
    // 3000 + 5000 − 500 + 1000 = 8500; si los pagos no suman, 400.
    const bad = await o
      .post('/v1/shop/sales', { ...body, payments: [{ method: 'cash', amountCents: 100 }] })
      .expect(400);
    expect(bad.body).toMatchObject({ totalCents: 8500, paidCents: 100 });

    const s = await o.post('/v1/shop/sales', body).expect(201);
    expect(s.body).toMatchObject({
      code: 'V-000001',
      status: 'completed',
      subtotalCents: 8000,
      discountCents: 500,
      tipCents: 1000,
      totalCents: 8500,
      customer: { id: A.customerId },
      tipStaff: { id: A.staffId },
      items: [
        {
          kind: 'service',
          name: 'Corte',
          unitPriceCents: 3000,
          totalCents: 3000,
          staff: { id: A.staffId },
        },
        { kind: 'product', name: 'Cera', quantity: 2, totalCents: 5000 },
      ],
    });
    expect(await stockOf(productId)).toBe(3);
    const cash = (await o.get('/v1/shop/cash/current').expect(200)).body.shift;
    expect(cash.totals.find((x: { method: string }) => x.method === 'cash').expectedCents).toBe(
      13000,
    );
    expect(cash.totals.find((x: { method: string }) => x.method === 'yape').expectedCents).toBe(
      5500,
    );
    expect(cash.movements.filter((m: { kind: string }) => m.kind === 'sale')).toHaveLength(2);
  });

  it('stock insuficiente: no queda nada a medias (ni el correlativo)', async () => {
    const o = api(ownerToken);
    const r = await o
      .post('/v1/shop/sales', {
        items: [{ kind: 'product', productId, quantity: 50 }],
        payments: [{ method: 'cash', amountCents: 125000 }],
      })
      .expect(409);
    expect(r.body.available).toBe(3);
    const next = await o
      .post('/v1/shop/sales', {
        items: [{ kind: 'product', productId }],
        payments: [{ method: 'card', amountCents: 2500 }],
      })
      .expect(201);
    expect(next.body.code).toBe('V-000002');
  });

  it('cobrar una cita la completa; no se cobra dos veces; anular la libera', async () => {
    const o = api(ownerToken);
    const sale = await o
      .post('/v1/shop/sales', {
        appointmentId: A.appointmentId,
        items: [{ kind: 'service', serviceId: A.serviceId, staffId: A.staffId }],
        payments: [{ method: 'cash', amountCents: 3000 }],
      })
      .expect(201);
    expect(sale.body).toMatchObject({
      appointmentId: A.appointmentId,
      customer: { id: A.customerId },
    });
    let appt = (await o.get(`/v1/shop/appointments/${A.appointmentId}`).expect(200)).body;
    expect(appt).toMatchObject({ status: 'completed', saleId: sale.body.id });

    const twice = await o
      .post('/v1/shop/sales', {
        appointmentId: A.appointmentId,
        items: [{ kind: 'service', serviceId: A.serviceId }],
        payments: [{ method: 'cash', amountCents: 3000 }],
      })
      .expect(409);
    expect(twice.body.saleNumber).toBe(sale.body.number);

    // Anular: motivo obligatorio; devuelve la plata en la caja y la cita queda por cobrar.
    await o.post(`/v1/shop/sales/${sale.body.id}/void`, {}).expect(400);
    const v = await o
      .post(`/v1/shop/sales/${sale.body.id}/void`, { reason: 'Se cobró a otro cliente' })
      .expect(200);
    expect(v.body).toMatchObject({
      status: 'voided',
      voidReason: 'Se cobró a otro cliente',
      voidedBy: expect.any(String),
    });
    await o.post(`/v1/shop/sales/${sale.body.id}/void`, { reason: 'Otra vez' }).expect(409);
    appt = (await o.get(`/v1/shop/appointments/${A.appointmentId}`).expect(200)).body;
    expect(appt.saleId).toBeNull();
    const refunds = (await o.get('/v1/shop/cash/current').expect(200)).body.shift.movements.filter(
      (m: { kind: string }) => m.kind === 'refund',
    );
    expect(refunds).toHaveLength(1);
  });

  it('anular devuelve el stock', async () => {
    const o = api(ownerToken);
    const before = await stockOf(productId);
    const s = await o
      .post('/v1/shop/sales', {
        items: [{ kind: 'product', productId, quantity: 2 }],
        payments: [{ method: 'cash', amountCents: 5000 }],
      })
      .expect(201);
    expect(await stockOf(productId)).toBe(before - 2);
    await o
      .post(`/v1/shop/sales/${s.body.id}/void`, { reason: 'Devolvió el producto' })
      .expect(200);
    expect(await stockOf(productId)).toBe(before);
  });

  it('ventas simultáneas: correlativos únicos y seguidos', async () => {
    const o = api(ownerToken);
    const res = await Promise.all(
      Array.from({ length: 6 }, () =>
        o.post('/v1/shop/sales', {
          items: [{ kind: 'service', serviceId: A.serviceId }],
          payments: [{ method: 'cash', amountCents: 3000 }],
        }),
      ),
    );
    expect(res.every((r) => r.status === 201)).toBe(true);
    const nums = res.map((r) => r.body.number as number).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(6);
    expect(nums[5]! - nums[0]!).toBe(5);
  });

  it('listado con búsqueda por número y resumen', async () => {
    const o = api(ownerToken);
    const byNum = await o.get('/v1/shop/sales?q=V-000002').expect(200);
    expect(byNum.body.items.map((s: { code: string }) => s.code)).toEqual(['V-000002']);
    const voided = await o.get('/v1/shop/sales?status=voided').expect(200);
    expect(voided.body.total).toBe(2);
    const all = await o.get('/v1/shop/sales?pageSize=5').expect(200);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.summary.count).toBe(all.body.total - 2); // las anuladas no suman
    const yape = await o.get('/v1/shop/sales?method=yape').expect(200);
    expect(yape.body.items.map((s: { code: string }) => s.code)).toEqual(['V-000001']);
  });

  it('permisos y aislamiento', async () => {
    const barber = api((await addMember(A, 'barber')).token);
    await barber
      .post('/v1/shop/sales', {
        items: [{ kind: 'service', serviceId: A.serviceId }],
        payments: [{ method: 'cash', amountCents: 3000 }],
      })
      .expect(403);
    const rec = api((await addMember(A, 'receptionist')).token);
    const s = await rec
      .post('/v1/shop/sales', {
        items: [{ kind: 'service', serviceId: A.serviceId }],
        payments: [{ method: 'cash', amountCents: 3000 }],
      })
      .expect(201);
    await rec.post(`/v1/shop/sales/${s.body.id}/void`, { reason: 'Sin permiso' }).expect(403); // anular: sales.void
    const b = api(await t.tokenFor(B.ownerUserId), B.slug);
    await b.get(`/v1/shop/sales/${s.body.id}`).expect(404);
    await b.post('/v1/shop/cash/open', { openingCents: 0 }).expect(201);
    // B no puede vender servicios ni productos de A.
    await b
      .post('/v1/shop/sales', {
        items: [{ kind: 'product', productId }],
        payments: [{ method: 'cash', amountCents: 2500 }],
      })
      .expect(404);
  });
});
