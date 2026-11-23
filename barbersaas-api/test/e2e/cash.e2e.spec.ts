/** Fase 2 · paso 21: caja (turnos, movimientos, arqueo). */
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
    [userId, email, `Persona ${role}`],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, $4, 'active', now())`,
    [randomUUID(), shop.barbershopId, userId, role],
  );
  return { token: await t.tokenFor(userId, email) };
}

const total = (body: { totals: Array<{ method: string; expectedCents: number }> }, m: string) =>
  body.totals.find((x) => x.method === m)?.expectedCents;

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'caja');
  B = await createTenant(owner, 'cajab');
  ownerToken = await t.tokenFor(A.ownerUserId);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('caja', () => {
  it('abrir, mover, cerrar con arqueo', async () => {
    const o = api(ownerToken);
    const cur = await o.get('/v1/shop/cash/current').expect(200);
    expect(cur.body).toMatchObject({ register: { name: 'Caja principal' }, shift: null });
    // Con la caja cerrada no se registran movimientos.
    const closed = await o
      .post('/v1/shop/cash/movements', { kind: 'income', amountCents: 100, concept: 'Prueba' })
      .expect(409);
    expect(closed.body.cashClosed).toBe(true);

    const opened = await o.post('/v1/shop/cash/open', { openingCents: 20000 }).expect(201);
    expect(opened.body).toMatchObject({
      status: 'open',
      openingCents: 20000,
      totals: [{ method: 'cash', expectedCents: 20000 }],
    });
    await o.post('/v1/shop/cash/open', { openingCents: 0 }).expect(409);

    await o
      .post('/v1/shop/cash/movements', {
        kind: 'income',
        method: 'yape',
        amountCents: 4500,
        concept: 'Pago adelantado',
      })
      .expect(201);
    await o
      .post('/v1/shop/cash/movements', {
        kind: 'expense',
        amountCents: 1500,
        concept: 'Compra de navajas',
      })
      .expect(201);
    // No se puede retirar más efectivo del que hay; los retiros son solo de efectivo.
    const over = await o
      .post('/v1/shop/cash/movements', {
        kind: 'withdrawal',
        amountCents: 999999,
        concept: 'Depósito al banco',
      })
      .expect(409);
    expect(over.body.availableCents).toBe(18500);
    await o
      .post('/v1/shop/cash/movements', {
        kind: 'withdrawal',
        method: 'yape',
        amountCents: 100,
        concept: 'Prueba',
      })
      .expect(409);
    const w = await o
      .post('/v1/shop/cash/movements', {
        kind: 'withdrawal',
        amountCents: 10000,
        concept: 'Depósito al banco',
      })
      .expect(201);
    expect(total(w.body, 'cash')).toBe(8500);
    expect(total(w.body, 'yape')).toBe(4500);
    expect(w.body.movements).toHaveLength(3);
    expect(w.body.movements[0]).toMatchObject({
      kind: 'withdrawal',
      createdBy: expect.any(String),
    });

    // Cierre: falta S/ 5.00 en efectivo; Yape no se contó (se da por cuadrado).
    await o.post('/v1/shop/cash/close', { counted: {} }).expect(400);
    const c = await o
      .post('/v1/shop/cash/close', { counted: { cash: 8000 }, notes: 'Faltan 5 soles' })
      .expect(200);
    expect(c.body).toMatchObject({
      status: 'closed',
      differenceCents: -500,
      notes: 'Faltan 5 soles',
    });
    expect(c.body.totals.find((x: { method: string }) => x.method === 'cash')).toMatchObject({
      expectedCents: 8500,
      countedCents: 8000,
      differenceCents: -500,
    });
    expect(c.body.totals.find((x: { method: string }) => x.method === 'yape')).toMatchObject({
      expectedCents: 4500,
      countedCents: 4500,
      differenceCents: 0,
    });
    await o.post('/v1/shop/cash/close', { counted: { cash: 0 } }).expect(409);

    // Historial
    const list = await o.get('/v1/shop/cash/shifts').expect(200);
    expect(list.body.items[0]).toMatchObject({
      id: c.body.id,
      status: 'closed',
      differenceCents: -500,
      movementsCount: 3,
    });
    const det = await o.get(`/v1/shop/cash/shifts/${c.body.id}`).expect(200);
    expect(det.body.movements).toHaveLength(3);
    expect((await o.get('/v1/shop/cash/current').expect(200)).body.shift).toBeNull();
  });

  it('dos aperturas simultáneas → solo una gana', async () => {
    const o = api(ownerToken);
    const res = await Promise.all(
      Array.from({ length: 5 }, () => o.post('/v1/shop/cash/open', { openingCents: 1000 })),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(4);
    await o.post('/v1/shop/cash/close', { counted: { cash: 1000 } }).expect(200);
  });

  it('permisos y aislamiento: recepción maneja la caja; el barbero no; B no ve los turnos de A', async () => {
    const r = api((await addMember(A, 'receptionist')).token);
    await r.post('/v1/shop/cash/open', { openingCents: 5000 }).expect(201);
    const b = api((await addMember(A, 'barber')).token);
    await b.get('/v1/shop/cash/current').expect(403);
    const bo = api(await t.tokenFor(B.ownerUserId), B.slug);
    expect((await bo.get('/v1/shop/cash/current').expect(200)).body.shift).toBeNull();
    const aShifts = (await api(ownerToken).get('/v1/shop/cash/shifts').expect(200)).body
      .items as Array<{ id: string }>;
    await bo.get(`/v1/shop/cash/shifts/${aShifts[0]!.id}`).expect(404);
    await r.post('/v1/shop/cash/close', { counted: { cash: 5000 } }).expect(200);
  });
});
