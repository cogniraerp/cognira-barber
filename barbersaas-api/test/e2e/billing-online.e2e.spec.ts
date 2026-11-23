/** Fase 2 · paso 25b: la barbería paga su suscripción con la pasarela de la plataforma. */
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let B: TenantFixture;
let ownerToken: string;
let superToken: string;
let adminToken: string;
let invoiceId: string;

const shop = (token: string, slug = A.slug) => ({
  get: (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug),
  post: (u: string, b?: object) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
});
const sa = () => ({
  get: (u: string) => request(t.http).get(u).set('Authorization', `Bearer ${superToken}`),
  post: (u: string, b?: object) =>
    request(t.http).post(u).set('Authorization', `Bearer ${superToken}`).send(b),
  patch: (u: string, b?: object) =>
    request(t.http).patch(u).set('Authorization', `Bearer ${superToken}`).send(b),
  del: (u: string) => request(t.http).delete(u).set('Authorization', `Bearer ${superToken}`),
});
const realFetch = globalThis.fetch;
function mockMercadoPago(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://api.mercadopago.com')) return realFetch(input, init);
    const body = routes[url.replace('https://api.mercadopago.com', '').split('?')[0]!];
    return Promise.resolve(
      body === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(body)),
    );
  });
}
afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  // La pasarela de la plataforma es global: este archivo es el único que la toca.
  await owner.query(
    `UPDATE platform_gateways SET deleted_at = now(), is_active = false WHERE deleted_at IS NULL`,
  );
  A = await createTenant(owner, 'bill');
  B = await createTenant(owner, 'billb');
  ownerToken = await t.tokenFor(A.ownerUserId);
  const su = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'Super', 'superadmin', now())`,
    [su, `${su}@test.pe`],
  );
  superToken = await t.tokenFor(su);
  const adminId = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Admin', now())`,
    [adminId, `${adminId}@test.pe`],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'admin', 'active', now())`,
    [randomUUID(), A.barbershopId, adminId],
  );
  adminToken = await t.tokenFor(adminId);
  invoiceId = (
    await owner.query<{ id: string }>(`SELECT id FROM invoices WHERE barbershop_id = $1`, [
      A.barbershopId,
    ])
  ).rows[0]!.id;
});

afterAll(async () => {
  await owner?.query(
    `UPDATE platform_gateways SET deleted_at = now(), is_active = false WHERE deleted_at IS NULL`,
  );
  await t?.close();
  await owner?.end();
});

describe('suscripción: pago en línea', () => {
  it('la barbería ve su plan y facturas; sin pasarela de plataforma no puede pagar en línea', async () => {
    const b = (await shop(ownerToken).get('/v1/shop/billing').expect(200)).body;
    expect(b.onlinePay).toBe(false);
    expect(b.subscription.plan).toMatchObject({ code: 'test-basic' });
    expect(b.invoices).toEqual([
      expect.objectContaining({ id: invoiceId, status: 'open', amountCents: 4900 }),
    ]);
    const r = await shop(ownerToken).post(`/v1/shop/billing/invoices/${invoiceId}/pay`).expect(409);
    expect(r.body.noGateway).toBe(true);
  });

  it('solo el superadmin configura la pasarela de la plataforma', async () => {
    await shop(ownerToken).get('/v1/platform/payment-gateways').expect(403);
    const r = await sa()
      .post('/v1/platform/payment-gateways', { provider: 'simulator' })
      .expect(201);
    expect(r.body).toMatchObject({ provider: 'simulator', isActive: true });
    expect(r.body.webhookUrl).toMatch(/\/v1\/webhooks\/platform-payments\//);
    await sa().post('/v1/platform/payment-gateways', { provider: 'simulator' }).expect(409);
  });

  it('el admin ve la suscripción pero solo el dueño paga; otra barbería no ve la factura', async () => {
    await shop(adminToken).get('/v1/shop/billing').expect(403);
    await shop(adminToken).post(`/v1/shop/billing/invoices/${invoiceId}/pay`).expect(403);
    const bToken = await t.tokenFor(B.ownerUserId);
    await shop(bToken, B.slug).post(`/v1/shop/billing/invoices/${invoiceId}/pay`).expect(404);
  });

  it('pagar con el simulador liquida la factura y activa la suscripción', async () => {
    const c = (
      await shop(ownerToken).post(`/v1/shop/billing/invoices/${invoiceId}/pay`).expect(201)
    ).body;
    expect(c).toMatchObject({ invoiceId, status: 'pending', amountCents: 4900 });
    // Pedirlo otra vez reutiliza el link vigente.
    const again = (
      await shop(ownerToken).post(`/v1/shop/billing/invoices/${invoiceId}/pay`).expect(201)
    ).body;
    expect(again.id).toBe(c.id);
    const url = new URL(c.checkoutUrl as string);
    const page = await request(t.http).get(`${url.pathname}${url.search}`).expect(200);
    expect(page.text).toContain('Suscripción Cognira Barber');
    await request(t.http)
      .post(url.pathname)
      .type('form')
      .send({ sig: url.searchParams.get('sig'), action: 'pay' })
      .expect(200);
    expect(
      (await shop(ownerToken).get(`/v1/shop/billing/charges/${c.id}`).expect(200)).body.status,
    ).toBe('paid');
    const b = (await shop(ownerToken).get('/v1/shop/billing').expect(200)).body;
    expect(b.invoices[0]).toMatchObject({ status: 'paid', paidAt: expect.any(String) });
    expect(b.subscription.status).toBe('active');
    expect(new Date(b.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(
      Date.now() + 20 * 86_400_000,
    );
    // Ya pagada: no se puede volver a pagar.
    await shop(ownerToken).post(`/v1/shop/billing/invoices/${invoiceId}/pay`).expect(409);
    const audit = await owner.query(
      `SELECT action FROM audit_logs WHERE barbershop_id = $1 AND action LIKE 'billing.invoice.%' ORDER BY created_at`,
      [A.barbershopId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'billing.invoice.pay_online',
      'billing.invoice.paid_online',
    ]);
  });

  it('Mercado Pago de la plataforma: el webhook firmado liquida la factura tras consultar la API', async () => {
    // Nueva factura abierta para A.
    const inv = (
      await sa()
        .post(`/v1/platform/barbershops/${A.barbershopId}/invoices`, { dueInDays: 5 })
        .expect(201)
    ).body;
    mockMercadoPago({ '/users/me': { id: 2, nickname: 'COGNIRA' } });
    const mp = (
      await sa()
        .post('/v1/platform/payment-gateways', {
          provider: 'mercadopago',
          credentials: {
            accessToken: 'TEST-9999999999-abcdefghijklmnopqrstuvwxyz',
            webhookSecret: 'plat',
          },
        })
        .expect(201)
    ).body;
    await sa().patch(`/v1/platform/payment-gateways/${mp.id}`, { isActive: true }).expect(200);
    const prefs: unknown[] = [];
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      if (!String(input).includes('/checkout/preferences')) return realFetch(input, init);
      prefs.push(JSON.parse(init!.body as string));
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'pref_p', init_point: 'https://mp/p' })),
      );
    });
    const c = (await shop(ownerToken).post(`/v1/shop/billing/invoices/${inv.id}/pay`).expect(201))
      .body;
    expect(c).toMatchObject({ provider: 'mercadopago', checkoutUrl: 'https://mp/p' });
    expect(prefs[0]).toMatchObject({
      external_reference: c.id,
      back_urls: { success: expect.stringContaining(`/s/${A.slug}/configuracion/suscripcion`) },
    });

    const hook = new URL(mp.webhookUrl as string).pathname;
    const body = { type: 'payment', data: { id: '555' } };
    const v1 = createHmac('sha256', 'plat').update('id:555;request-id:rq;ts:1;').digest('hex');
    await request(t.http)
      .post(hook)
      .set('x-signature', `ts=1,v1=bad`)
      .set('x-request-id', 'rq')
      .send(body)
      .expect(401);
    mockMercadoPago({
      '/v1/payments/555': {
        id: 555,
        status: 'approved',
        external_reference: c.id,
        transaction_amount: inv.amountCents / 100,
        currency_id: 'PEN',
      },
    });
    await request(t.http)
      .post(hook)
      .set('x-signature', `ts=1,v1=${v1}`)
      .set('x-request-id', 'rq')
      .send(body)
      .expect(200);
    const list = (
      await sa().get(`/v1/platform/invoices?barbershopId=${A.barbershopId}&status=paid`).expect(200)
    ).body;
    expect(list.items.find((i: { id: string }) => i.id === inv.id)).toMatchObject({
      status: 'paid',
      gatewayRef: '555',
    });
    // Repetido: idempotente (no falla por "ya pagada").
    await request(t.http)
      .post(hook)
      .set('x-signature', `ts=1,v1=${v1}`)
      .set('x-request-id', 'rq')
      .send(body)
      .expect(200);
  });

  it('un pago que llega con la factura ya pagada a mano queda marcado para devolver', async () => {
    const inv = (
      await sa()
        .post(`/v1/platform/barbershops/${A.barbershopId}/invoices`, { dueInDays: 5 })
        .expect(201)
    ).body;
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
      String(input).includes('/checkout/preferences')
        ? Promise.resolve(
            new Response(JSON.stringify({ id: 'pref_q', init_point: 'https://mp/q' })),
          )
        : realFetch(input, init),
    );
    const c = (await shop(ownerToken).post(`/v1/shop/billing/invoices/${inv.id}/pay`).expect(201))
      .body;
    await sa()
      .post(`/v1/platform/invoices/${inv.id}/mark-paid`, { gatewayRef: 'YAPE-1' })
      .expect(200);
    mockMercadoPago({
      '/v1/payments/search': {
        results: [
          {
            id: 77,
            status: 'approved',
            external_reference: c.id,
            transaction_amount: inv.amountCents / 100,
            currency_id: 'PEN',
          },
        ],
      },
    });
    expect(
      (await shop(ownerToken).post(`/v1/shop/billing/charges/${c.id}/refresh`).expect(200)).body
        .status,
    ).toBe('paid');
    const row = await owner.query(`SELECT last_event FROM invoice_charges WHERE id = $1`, [c.id]);
    expect(row.rows[0].last_event.warning).toMatch(/devolver/);
  });
});
