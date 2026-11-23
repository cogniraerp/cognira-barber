/** Fase 2 · paso 25a: pasarela propia de la barbería y cobros por link/QR. */
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
let tokenA: string;
let tokenB: string;
let barberToken: string;

const api = (token: string, slug: string) => {
  const h = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug);
  return {
    get: (u: string) => h(request(t.http).get(u)),
    post: (u: string, b?: object) => h(request(t.http).post(u)).send(b),
    patch: (u: string, b?: object) => h(request(t.http).patch(u)).send(b),
    del: (u: string) => h(request(t.http).delete(u)),
  };
};
const a = () => api(tokenA, A.slug);
const realFetch = globalThis.fetch;
/** Simula la API de Mercado Pago (las demás URLs siguen saliendo normal). */
function mockMercadoPago(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://api.mercadopago.com')) return realFetch(input, init);
    const path = url.replace('https://api.mercadopago.com', '').split('?')[0]!;
    const body = routes[path];
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
  A = await createTenant(owner, 'pay');
  B = await createTenant(owner, 'paynf');
  tokenA = await t.tokenFor(A.ownerUserId);
  tokenB = await t.tokenFor(B.ownerUserId);
  // Plan con pagos en línea solo para A (B queda en el plan básico de pruebas).
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, features, updated_at)
     VALUES ($1, 'test-pro-pay', 'Pro', 9900, 99000, '{"onlinePayments": true}', now())
     ON CONFLICT (code) DO UPDATE SET features = EXCLUDED.features RETURNING id`,
    [randomUUID()],
  );
  await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
    rows[0]!.id,
    A.barbershopId,
  ]);
  await a().post('/v1/shop/cash/open', { openingCents: 0 }).expect(201);
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
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

const corte = (payments: object[]) => ({
  items: [{ kind: 'service', serviceId: A.serviceId, staffId: A.staffId }],
  payments,
});

describe('pasarela de la barbería', () => {
  let simId: string;

  it('sin el plan no se conecta; el barbero no gestiona; sin pasarela no se cobra en línea', async () => {
    await api(tokenB, B.slug)
      .post('/v1/shop/payment-gateways', { provider: 'simulator' })
      .expect(402);
    expect(
      (await api(tokenB, B.slug).get('/v1/shop/payment-gateways').expect(200)).body.enabled,
    ).toBe(false);
    await api(barberToken, A.slug).get('/v1/shop/payment-gateways').expect(403);
    const r = await a().post('/v1/shop/payment-charges', { amountCents: 3000 }).expect(409);
    expect(r.body.noGateway).toBe(true);
  });

  it('conecta el simulador (queda activo) y no deja duplicarlo', async () => {
    const r = await a().post('/v1/shop/payment-gateways', { provider: 'simulator' }).expect(201);
    simId = r.body.id;
    expect(r.body).toMatchObject({
      provider: 'simulator',
      isActive: true,
      status: 'ok',
      mode: 'test',
    });
    expect(r.body.webhookUrl).toMatch(/\/v1\/webhooks\/payments\/[\w-]{20,}$/);
    await a().post('/v1/shop/payment-gateways', { provider: 'simulator' }).expect(409);
    const o = (await a().get('/v1/shop/payment-gateways').expect(200)).body;
    expect(o.enabled).toBe(true);
    expect(o.accounts).toHaveLength(1);
    expect(o.providers.map((p: { id: string }) => p.id)).toEqual([
      'simulator',
      'mercadopago',
      'izipay',
    ]);
    // Las credenciales nunca salen de la API.
    expect(JSON.stringify(o.accounts)).not.toMatch(/credentials|webhookToken|accessToken/);
  });

  it('link de pago → checkout simulado → pagado → la venta lo usa una sola vez', async () => {
    const c = (await a().post('/v1/shop/payment-charges', { amountCents: 3000 }).expect(201)).body;
    expect(c).toMatchObject({
      status: 'pending',
      provider: 'simulator',
      amountCents: 3000,
      sale: null,
    });
    const url = new URL(c.checkoutUrl as string);
    const sig = url.searchParams.get('sig')!;

    // No se puede usar en una venta hasta que esté pagado.
    await a()
      .post('/v1/shop/sales', corte([{ method: 'online', amountCents: 3000, chargeId: c.id }]))
      .expect(409);
    // "online" exige cobro, y el cobro solo va con "online".
    await a()
      .post('/v1/shop/sales', corte([{ method: 'online', amountCents: 3000 }]))
      .expect(400);
    await a()
      .post('/v1/shop/sales', corte([{ method: 'cash', amountCents: 3000, chargeId: c.id }]))
      .expect(400);

    // Checkout: firma inválida → 404; rechazar deja pendiente; pagar lo cierra.
    await request(t.http).get(`/v1/public/pay/simulator/${c.id}?sig=xxx`).expect(404);
    const page = await request(t.http).get(`${url.pathname}${url.search}`).expect(200);
    expect(page.text).toContain('Simulador');
    await request(t.http)
      .post(`/v1/public/pay/simulator/${c.id}`)
      .type('form')
      .send({ sig, action: 'reject' })
      .expect(200);
    expect((await a().get(`/v1/shop/payment-charges/${c.id}`).expect(200)).body.status).toBe(
      'pending',
    );
    const paid = await request(t.http)
      .post(`/v1/public/pay/simulator/${c.id}`)
      .type('form')
      .send({ sig, action: 'pay' })
      .expect(200);
    expect(paid.text).toContain('Pago aprobado');
    const after = (await a().get(`/v1/shop/payment-charges/${c.id}`).expect(200)).body;
    expect(after).toMatchObject({
      status: 'paid',
      providerPaymentId: expect.stringMatching(/^sim_/),
    });

    // Monto distinto → 409. Pago mixto: 10 efectivo + 20 en línea con un cobro de 20 → ok.
    await a()
      .post(
        '/v1/shop/sales',
        corte([
          { method: 'online', amountCents: 2000, chargeId: c.id },
          { method: 'cash', amountCents: 1000 },
        ]),
      )
      .expect(409);
    const sale = (
      await a()
        .post('/v1/shop/sales', corte([{ method: 'online', amountCents: 3000, chargeId: c.id }]))
        .expect(201)
    ).body;
    expect(sale.payments[0]).toMatchObject({
      method: 'online',
      reference: after.providerPaymentId,
    });
    await a()
      .post('/v1/shop/sales', corte([{ method: 'online', amountCents: 3000, chargeId: c.id }]))
      .expect(409);
    const linked = (await a().get(`/v1/shop/payment-charges/${c.id}`).expect(200)).body;
    expect(linked.sale).toEqual({ id: sale.id, code: sale.code });
    // En la caja entra como método "online".
    const cash = (await a().get('/v1/shop/cash/current').expect(200)).body.shift;
    expect(cash.movements.some((m: { method: string }) => m.method === 'online')).toBe(true);
  });

  it('cancelar un cobro pendiente; otra barbería no lo ve', async () => {
    const c = (await a().post('/v1/shop/payment-charges', { amountCents: 1500 }).expect(201)).body;
    await api(tokenB, B.slug).get(`/v1/shop/payment-charges/${c.id}`).expect(404);
    expect(
      (await a().post(`/v1/shop/payment-charges/${c.id}/cancel`).expect(200)).body.status,
    ).toBe('canceled');
    await a().post(`/v1/shop/payment-charges/${c.id}/cancel`).expect(409);
    const list = (await a().get('/v1/shop/payment-charges?status=canceled').expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toContain(c.id);
  });

  it('Mercado Pago: conecta, crea el link y el webhook (firmado) marca el pago tras consultar la API', async () => {
    const token = 'TEST-1234567890-abcdefghijklmnopqrstuvwxyz';
    mockMercadoPago({ '/users/me': { id: 1, nickname: 'BARBERIA_TEST' } });
    await a()
      .post('/v1/shop/payment-gateways', {
        provider: 'mercadopago',
        credentials: { accessToken: 'malo' },
      })
      .expect(400);
    const acc = (
      await a()
        .post('/v1/shop/payment-gateways', {
          provider: 'mercadopago',
          credentials: { accessToken: token, webhookSecret: 'shh' },
        })
        .expect(201)
    ).body;
    expect(acc).toMatchObject({
      isActive: false,
      mode: 'test',
      publicInfo: { account: 'BARBERIA_TEST', token: 'TEST-123…wxyz' },
    });
    // Activarla desactiva el simulador (solo una activa).
    await a().patch(`/v1/shop/payment-gateways/${acc.id}`, { isActive: true }).expect(200);
    const accounts = (await a().get('/v1/shop/payment-gateways').expect(200)).body
      .accounts as Array<{ id: string; isActive: boolean }>;
    expect(accounts.find((x) => x.id === simId)!.isActive).toBe(false);

    mockMercadoPago({
      '/checkout/preferences': {
        id: 'pref_1',
        init_point: 'https://mp/live',
        sandbox_init_point: 'https://mp/sandbox',
      },
    });
    const c = (await a().post('/v1/shop/payment-charges', { amountCents: 4500 }).expect(201)).body;
    expect(c).toMatchObject({ provider: 'mercadopago', checkoutUrl: 'https://mp/sandbox' });

    const hook = new URL(acc.webhookUrl as string).pathname;
    const body = { type: 'payment', data: { id: '777' } };
    const ts = '1700000000';
    const v1 = createHmac('sha256', 'shh').update(`id:777;request-id:r1;ts:${ts};`).digest('hex');
    // Firma inválida → 401 y nada cambia.
    await request(t.http)
      .post(hook)
      .set('x-signature', `ts=${ts},v1=${'0'.repeat(64)}`)
      .set('x-request-id', 'r1')
      .send(body)
      .expect(401);
    const approved = {
      id: 777,
      status: 'approved',
      external_reference: c.id,
      transaction_amount: 45,
      currency_id: 'PEN',
    };
    mockMercadoPago({ '/v1/payments/777': approved });
    await request(t.http)
      .post(hook)
      .set('x-signature', `ts=${ts},v1=${v1}`)
      .set('x-request-id', 'r1')
      .send(body)
      .expect(200);
    expect((await a().get(`/v1/shop/payment-charges/${c.id}`).expect(200)).body).toMatchObject({
      status: 'paid',
      providerPaymentId: '777',
    });
    // Repetido: idempotente. Token desconocido: 200 sin efecto.
    await request(t.http)
      .post(hook)
      .set('x-signature', `ts=${ts},v1=${v1}`)
      .set('x-request-id', 'r1')
      .send(body)
      .expect(200);
    await request(t.http).post('/v1/webhooks/payments/desconocido').send(body).expect(200);
  });

  it('"Verificar ahora" consulta la pasarela (sin webhook, como en local)', async () => {
    mockMercadoPago({ '/checkout/preferences': { id: 'pref_2', init_point: 'https://mp/live' } });
    const c = (await a().post('/v1/shop/payment-charges', { amountCents: 2000 }).expect(201)).body;
    mockMercadoPago({ '/v1/payments/search': { results: [] } });
    expect(
      (await a().post(`/v1/shop/payment-charges/${c.id}/refresh`).expect(200)).body.status,
    ).toBe('pending');
    mockMercadoPago({
      '/v1/payments/search': {
        results: [
          {
            id: 9,
            status: 'approved',
            external_reference: c.id,
            transaction_amount: 20,
            currency_id: 'PEN',
          },
        ],
      },
    });
    expect(
      (await a().post(`/v1/shop/payment-charges/${c.id}/refresh`).expect(200)).body,
    ).toMatchObject({ status: 'paid', providerPaymentId: '9' });
  });

  it('si la pasarela falla al crear el link → 502 y el cobro queda fallido; desconectar', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{"message":"boom"}', { status: 500 })),
    );
    const r = await a().post('/v1/shop/payment-charges', { amountCents: 1000 }).expect(502);
    expect(JSON.stringify(r.body)).toMatch(/Mercado Pago respondió 500: boom/);
    expect(r.body.code).toBe('GATEWAY_ERROR');
    expect((await a().get('/v1/shop/payment-charges?status=failed').expect(200)).body.total).toBe(
      1,
    );
    const accounts = (await a().get('/v1/shop/payment-gateways').expect(200)).body
      .accounts as Array<{ id: string; provider: string }>;
    const mp = accounts.find((x) => x.provider === 'mercadopago')!;
    await a().del(`/v1/shop/payment-gateways/${mp.id}`).expect(204);
    expect((await a().get('/v1/shop/payment-gateways').expect(200)).body.accounts).toHaveLength(1);
  });
});

/** Simula la API REST de Izipay: responde según el endpoint y guarda los cuerpos enviados. */
function mockIzipay(
  routes: Record<string, unknown>,
  sent: Array<{ path: string; body: unknown }> = [],
) {
  const base = 'https://api.micuentaweb.pe/api-payment/V4/';
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(base)) return realFetch(input, init);
    const path = url.slice(base.length);
    sent.push({ path, body: JSON.parse((init?.body as string | undefined) ?? '{}') });
    const answer = routes[path];
    return Promise.resolve(
      new Response(
        JSON.stringify(
          answer === undefined
            ? { status: 'ERROR', answer: { errorCode: 'PSP_010', errorMessage: 'not found' } }
            : { status: 'SUCCESS', answer },
        ),
      ),
    );
  });
}

describe('Izipay', () => {
  const creds = { shopId: '12345678', password: 'testpassword_e2eabcdefghijk' };

  it('conecta, crea el link, el IPN firmado (form-urlencoded) marca el pago; firma mala → 401', async () => {
    mockIzipay({ 'Charge/SDKTest': { value: 'cognira' } });
    await a()
      .post('/v1/shop/payment-gateways', { provider: 'izipay', credentials: { shopId: 'x' } })
      .expect(400);
    const acc = (
      await a()
        .post('/v1/shop/payment-gateways', { provider: 'izipay', credentials: creds })
        .expect(201)
    ).body;
    expect(acc).toMatchObject({
      mode: 'test',
      publicInfo: { account: 'Tienda 12345678', user: '12345678' },
    });
    expect(JSON.stringify(acc)).not.toContain(creds.password);
    await a().patch(`/v1/shop/payment-gateways/${acc.id}`, { isActive: true }).expect(200);

    const sent: Array<{ path: string; body: unknown }> = [];
    mockIzipay(
      { 'Charge/CreatePaymentOrder': { paymentOrderId: 'po_1', paymentURL: 'https://izi/pay/1' } },
      sent,
    );
    const c = (await a().post('/v1/shop/payment-charges', { amountCents: 3500 }).expect(201)).body;
    expect(c).toMatchObject({ provider: 'izipay', checkoutUrl: 'https://izi/pay/1' });
    expect(sent[0]!.body).toMatchObject({ amount: 3500, currency: 'PEN', orderId: c.id });

    const hook = new URL(acc.webhookUrl as string).pathname;
    const answer = JSON.stringify({
      orderStatus: 'PAID',
      orderDetails: { orderId: c.id },
      transactions: [{ uuid: 'tx-9' }],
    });
    const form = (hash: string) => ({
      'kr-hash': hash,
      'kr-hash-algorithm': 'sha256_hmac',
      'kr-hash-key': 'password',
      'kr-answer-type': 'V4/Payment',
      'kr-answer': answer,
    });
    await request(t.http)
      .post(hook)
      .type('form')
      .send(form('0'.repeat(64)))
      .expect(401);

    const good = createHmac('sha256', creds.password).update(answer).digest('hex');
    // El aviso solo dice "algo cambió": el monto lo confirma Order/Get. Monto distinto → sigue pendiente.
    mockIzipay({
      'Order/Get': {
        transactions: [{ uuid: 'tx-9', status: 'PAID', amount: 100, currency: 'PEN' }],
      },
    });
    await request(t.http).post(hook).type('form').send(form(good)).expect(200);
    expect((await a().get(`/v1/shop/payment-charges/${c.id}`).expect(200)).body.status).toBe(
      'pending',
    );

    mockIzipay({
      'Order/Get': {
        transactions: [{ uuid: 'tx-9', status: 'PAID', amount: 3500, currency: 'PEN' }],
      },
    });
    await request(t.http).post(hook).type('form').send(form(good)).expect(200);
    expect((await a().get(`/v1/shop/payment-charges/${c.id}`).expect(200)).body).toMatchObject({
      status: 'paid',
      providerPaymentId: 'tx-9',
    });
  });

  it('un IPN válido de A no toca cobros de otra barbería', async () => {
    const accA = (
      (await a().get('/v1/shop/payment-gateways').expect(200)).body.accounts as Array<{
        provider: string;
        webhookUrl: string;
      }>
    ).find((x) => x.provider === 'izipay')!;
    const foreign = randomUUID();
    const answer = JSON.stringify({
      orderDetails: { orderId: foreign },
      transactions: [{ uuid: 'tx-x' }],
    });
    const sent: Array<{ path: string; body: unknown }> = [];
    mockIzipay({}, sent);
    await request(t.http)
      .post(new URL(accA.webhookUrl).pathname)
      .type('form')
      .send({
        'kr-hash': createHmac('sha256', creds.password).update(answer).digest('hex'),
        'kr-hash-key': 'password',
        'kr-answer': answer,
      })
      .expect(200);
    expect(sent).toHaveLength(0);
  });
});
