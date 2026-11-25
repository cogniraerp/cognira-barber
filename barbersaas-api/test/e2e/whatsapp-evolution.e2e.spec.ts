import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HTTP_FETCH } from '../../src/modules/notifications/providers/types';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

/** Evolution simulado (formas de v2.3.7); las demás URLs salen normal. */
const instances = new Map<string, { state: 'connecting' | 'open'; jid: string | null }>();
const sent: Array<{ instance: string; number: string; text: string }> = [];
const QR = 'data:image/png;base64,iVBORw0KGgo';
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const fakeFetch = ((input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.host !== 'evo.test:8080') return realFetch(input, init);
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (url.pathname === '/instance/create') {
    const b = JSON.parse(init?.body as string) as { instanceName: string };
    instances.set(b.instanceName, { state: 'connecting', jid: null });
    return json(201, { instance: { instanceName: b.instanceName }, qrcode: { base64: QR } });
  }
  if (url.pathname.startsWith('/instance/connectionState/')) {
    const i = instances.get(name);
    return i ? json(200, { instance: { state: i.state } }) : json(404, {});
  }
  if (url.pathname.startsWith('/instance/connect/'))
    return json(200, { base64: QR, pairingCode: 'None' });
  if (url.pathname === '/instance/fetchInstances')
    return json(200, [
      { ownerJid: instances.get(url.searchParams.get('instanceName')!)?.jid ?? null },
    ]);
  if (url.pathname.startsWith('/message/sendText/')) {
    const b = JSON.parse(init?.body as string) as { number: string; text: string };
    sent.push({ instance: name, ...b });
    return json(201, { key: { id: `evo-${sent.length}` } });
  }
  if (url.pathname.startsWith('/instance/logout/')) {
    instances.set(name, { state: 'connecting', jid: null });
    return json(200, {});
  }
  return json(404, {});
}) as typeof fetch;
const link = (name: string, phone: string) =>
  instances.set(name, { state: 'open', jid: `${phone}@s.whatsapp.net` });

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let B: TenantFixture;
let tokenA: string;
let superToken: string;
let supportToken: string;

const shop = (token: string, slug: string) => ({
  get: (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug),
  put: (u: string, b: object) =>
    request(t.http)
      .put(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
  post: (u: string, b?: object) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
});
async function createUser(role: 'superadmin' | 'support') {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'U', $3, now())`,
    [id, `${id}@test.pe`, role],
  );
  return id;
}

beforeAll(async () => {
  process.env.EVOLUTION_URL = 'http://evo.test:8080';
  process.env.EVOLUTION_API_KEY = 'k';
  t = await createTestApp([], [{ provide: HTTP_FETCH, useValue: fakeFetch }]);
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'evo');
  B = await createTenant(owner, 'evob');
  tokenA = await t.tokenFor(A.ownerUserId);
  superToken = await t.tokenFor(await createUser('superadmin'));
  supportToken = await t.tokenFor(await createUser('support'));
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
  delete process.env.EVOLUTION_URL;
  delete process.env.EVOLUTION_API_KEY;
});

describe('WhatsApp con QR (Evolution) por barbería', () => {
  const instA = () => `cognira-${A.barbershopId}`;

  it('sin elegir el proveedor no hay QR', async () => {
    await shop(tokenA, A.slug).post('/v1/shop/whatsapp/qr').expect(409);
  });

  it('elegir "WhatsApp con QR" crea su instancia y muestra el QR; al escanear queda conectada con su número', async () => {
    const cfg = (
      await shop(tokenA, A.slug).put('/v1/shop/whatsapp', { provider: 'evolution' }).expect(200)
    ).body;
    expect(cfg).toMatchObject({ provider: 'evolution', status: 'unverified' });
    const q = (await shop(tokenA, A.slug).post('/v1/shop/whatsapp/qr').expect(200)).body;
    expect(q).toEqual({ state: 'connecting', qr: QR, pairingCode: null, phone: null });
    expect(instances.has(instA())).toBe(true);
    link(instA(), '51987000111');
    expect(
      (await shop(tokenA, A.slug).post('/v1/shop/whatsapp/qr').expect(200)).body,
    ).toMatchObject({ state: 'open', phone: '+51987000111' });
    expect((await shop(tokenA, A.slug).get('/v1/shop/whatsapp').expect(200)).body).toMatchObject({
      status: 'ok',
      displayPhone: '+51987000111',
    });
  });

  it('el mensaje de prueba sale desde SU número (su instancia)', async () => {
    const r = (
      await shop(tokenA, A.slug)
        .post('/v1/shop/whatsapp/test', { to: '+51 911 222 333' })
        .expect(200)
    ).body;
    expect(r).toMatchObject({ status: 'sent', provider: 'evolution' });
    expect(sent.at(-1)).toMatchObject({ instance: instA(), number: '51911222333' });
  });

  it('otra barbería tiene su propia instancia; un barbero no gestiona el WhatsApp', async () => {
    const tokenB = await t.tokenFor(B.ownerUserId);
    await shop(tokenB, B.slug).put('/v1/shop/whatsapp', { provider: 'evolution' }).expect(200);
    await shop(tokenB, B.slug).post('/v1/shop/whatsapp/qr').expect(200);
    expect(instances.has(`cognira-${B.barbershopId}`)).toBe(true);
    expect(instances.get(`cognira-${B.barbershopId}`)!.state).toBe('connecting');
    const barber = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'B', now())`,
      [barber, `${barber}@test.pe`],
    );
    await owner.query(
      `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
      [randomUUID(), A.barbershopId, barber],
    );
    await shop(await t.tokenFor(barber), A.slug)
      .post('/v1/shop/whatsapp/qr')
      .expect(403);
  });

  it('desvincular: queda sin verificar y los mensajes pasan a envío manual', async () => {
    const r = (await shop(tokenA, A.slug).post('/v1/shop/whatsapp/disconnect').expect(200)).body;
    expect(r).toMatchObject({ provider: 'evolution', status: 'unverified', displayPhone: null });
    const test = (
      await shop(tokenA, A.slug).post('/v1/shop/whatsapp/test', { to: '+51911222333' }).expect(200)
    ).body;
    expect(test).toMatchObject({ status: 'manual' });
  });
});

describe('WhatsApp de la plataforma (número de Cognira)', () => {
  it('el superadmin ve el estado y vincula por QR; soporte no', async () => {
    await request(t.http)
      .get('/v1/platform/whatsapp')
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(403);
    const st = (
      await request(t.http)
        .get('/v1/platform/whatsapp')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)
    ).body;
    expect(st).toMatchObject({
      evolutionConfigured: true,
      instance: 'cognira-plataforma',
      state: 'missing',
    });
    const q = (
      await request(t.http)
        .post('/v1/platform/whatsapp/qr')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)
    ).body;
    expect(q.qr).toBe(QR);
    link('cognira-plataforma', '51999888777');
    const after = (
      await request(t.http)
        .get('/v1/platform/whatsapp')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)
    ).body;
    expect(after).toMatchObject({ state: 'open', phone: '+51999888777' });
  });
});
