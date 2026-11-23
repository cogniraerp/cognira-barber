/** Fase 2 · paso 20: productos e inventario por sede. */
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
    patch: (u: string, b?: object) => h(request(t.http).patch(u)).send(b),
    delete: (u: string) => h(request(t.http).delete(u)),
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

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'inv');
  B = await createTenant(owner, 'invb');
  ownerToken = await t.tokenFor(A.ownerUserId);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('productos', () => {
  it('alta con stock inicial; SKU y código de barras únicos por barbería', async () => {
    const o = api(ownerToken);
    const p = await o
      .post('/v1/shop/products', {
        name: 'Cera mate',
        sku: 'CER-01',
        barcode: '7750000000011',
        category: 'Ceras',
        priceCents: 3500,
        costCents: 1800,
        stockMin: 3,
        initialStock: 10,
      })
      .expect(201);
    expect(p.body).toMatchObject({
      name: 'Cera mate',
      stock: 10,
      isLow: false,
      stocks: [{ quantity: 10 }],
    });
    await o.post('/v1/shop/products', { name: 'Otra', sku: 'cer-01', priceCents: 100 }).expect(409);
    await o
      .post('/v1/shop/products', { name: 'Otra', barcode: '7750000000011', priceCents: 100 })
      .expect(409);
    await o.post('/v1/shop/products', { name: 'X', priceCents: -1 }).expect(400);
    // En otra barbería el mismo SKU está libre.
    await api(await t.tokenFor(B.ownerUserId), B.slug)
      .post('/v1/shop/products', { name: 'Cera B', sku: 'CER-01', priceCents: 100 })
      .expect(201);

    const mov = await o.get(`/v1/shop/inventory/movements?productId=${p.body.id}`).expect(200);
    expect(mov.body.items).toEqual([
      expect.objectContaining({
        kind: 'purchase',
        quantity: 10,
        balance: 10,
        note: 'Stock inicial',
      }),
    ]);
  });

  it('compra actualiza costo; ajuste por conteo; no permite stock negativo; stock bajo', async () => {
    const o = api(ownerToken);
    const p = (
      await o
        .post('/v1/shop/products', {
          name: 'Shampoo',
          category: 'Cuidado',
          priceCents: 2500,
          costCents: 1000,
          stockMin: 5,
        })
        .expect(201)
    ).body;
    expect(p).toMatchObject({ stock: 0, isLow: true });

    expect(
      (
        await o
          .post('/v1/shop/inventory/movements', {
            kind: 'purchase',
            items: [{ productId: p.id, quantity: 12, unitCostCents: 1200 }],
            note: 'Factura 001-123',
          })
          .expect(201)
      ).body,
    ).toEqual({ created: 1, skipped: 0 });
    let cur = (await o.get(`/v1/shop/products/${p.id}`).expect(200)).body;
    expect(cur).toMatchObject({ stock: 12, costCents: 1200, isLow: false });

    // Ajuste: se contaron 4 → diferencia −8, y queda en stock bajo.
    await o
      .post('/v1/shop/inventory/movements', {
        kind: 'adjustment',
        items: [{ productId: p.id, counted: 4 }],
      })
      .expect(400); // falta el motivo
    await o
      .post('/v1/shop/inventory/movements', {
        kind: 'adjustment',
        items: [{ productId: p.id, counted: 4 }],
        note: 'Conteo mensual',
      })
      .expect(201);
    cur = (await o.get(`/v1/shop/products/${p.id}`).expect(200)).body;
    expect(cur).toMatchObject({ stock: 4, isLow: true });
    // Contar lo mismo que hay no genera movimiento.
    expect(
      (
        await o
          .post('/v1/shop/inventory/movements', {
            kind: 'adjustment',
            items: [{ productId: p.id, counted: 4 }],
            note: 'Recuento',
          })
          .expect(201)
      ).body,
    ).toEqual({ created: 0, skipped: 1 });

    const neg = await o
      .post('/v1/shop/inventory/movements', {
        kind: 'adjustment',
        items: [{ productId: p.id, quantity: -5 }],
        note: 'Rotura',
      })
      .expect(409);
    expect(neg.body.available).toBe(4);

    const low = await o.get('/v1/shop/products?lowStock=true').expect(200);
    expect(low.body.items.map((x: { name: string }) => x.name)).toContain('Shampoo');
    const cats = await o.get('/v1/shop/products/categories').expect(200);
    expect(cats.body).toEqual(expect.arrayContaining([{ category: 'Cuidado', count: 1 }]));

    const movs = await o.get(`/v1/shop/inventory/movements?productId=${p.id}`).expect(200);
    expect(
      movs.body.items.map((m: { kind: string; quantity: number; balance: number }) => [
        m.kind,
        m.quantity,
        m.balance,
      ]),
    ).toEqual([
      ['adjustment', -8, 4],
      ['purchase', 12, 12],
    ]);
  });

  it('compras simultáneas no se pisan (stock con bloqueo de fila)', async () => {
    const o = api(ownerToken);
    const p = (
      await o.post('/v1/shop/products', { name: 'Aceite barba', priceCents: 3000 }).expect(201)
    ).body;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        o
          .post('/v1/shop/inventory/movements', {
            kind: 'purchase',
            items: [{ productId: p.id, quantity: 5 }],
          })
          .expect(201),
      ),
    );
    expect((await o.get(`/v1/shop/products/${p.id}`).expect(200)).body.stock).toBe(40);
  });

  it('búsqueda, filtros y paginación', async () => {
    const o = api(ownerToken);
    const byCode = await o.get('/v1/shop/products?q=7750000000011').expect(200);
    expect(byCode.body.items.map((x: { name: string }) => x.name)).toEqual(['Cera mate']);
    const page = await o.get('/v1/shop/products?pageSize=2&page=1').expect(200);
    expect(page.body).toMatchObject({ page: 1, pageSize: 2 });
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBeGreaterThanOrEqual(3);
  });

  it('permisos: recepción ve y ajusta inventario pero no edita el catálogo; el barbero no ve nada', async () => {
    const r = api((await addMember(A, 'receptionist')).token);
    const list = await r.get('/v1/shop/products').expect(200);
    const id = list.body.items[0].id as string;
    await r
      .post('/v1/shop/inventory/movements', {
        kind: 'purchase',
        items: [{ productId: id, quantity: 1 }],
      })
      .expect(201);
    await r.post('/v1/shop/products', { name: 'Nuevo', priceCents: 100 }).expect(403);
    await r.patch(`/v1/shop/products/${id}`, { priceCents: 1 }).expect(403);

    const b = api((await addMember(A, 'barber')).token);
    await b.get('/v1/shop/products').expect(403);
    await b.get('/v1/shop/inventory/movements').expect(403);
  });

  it('aislamiento: la barbería B no ve ni mueve productos de A', async () => {
    const o = api(ownerToken);
    const p = (
      await o.post('/v1/shop/products', { name: 'Solo de A', priceCents: 100 }).expect(201)
    ).body;
    const b = api(await t.tokenFor(B.ownerUserId), B.slug);
    await b.get(`/v1/shop/products/${p.id}`).expect(404);
    await b
      .post('/v1/shop/inventory/movements', {
        kind: 'purchase',
        items: [{ productId: p.id, quantity: 1 }],
      })
      .expect(404);
    const listB = await b.get('/v1/shop/products').expect(200);
    expect(listB.body.items.map((x: { name: string }) => x.name)).not.toContain('Solo de A');
  });

  it('archivar: deja de listarse pero el historial se conserva', async () => {
    const o = api(ownerToken);
    const p = (
      await o
        .post('/v1/shop/products', { name: 'Para archivar', priceCents: 100, initialStock: 2 })
        .expect(201)
    ).body;
    await o.delete(`/v1/shop/products/${p.id}`).expect(204);
    await o.get(`/v1/shop/products/${p.id}`).expect(404);
    const movs = await o.get(`/v1/shop/inventory/movements?productId=${p.id}`).expect(200);
    expect(movs.body.total).toBe(1);
  });
});
