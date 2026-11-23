import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { DNS_RESOLVER, type DnsResolver } from '../../src/modules/domains/dns-resolver';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

/** DNS simulado: lo que "publica" el dueño en su proveedor de dominios. */
const records = new Map<string, { txt?: string[][]; cname?: string[]; a?: string[] }>();
const notFound = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
const fakeDns: DnsResolver = {
  resolveTxt: (h) =>
    records.get(h)?.txt ? Promise.resolve(records.get(h)!.txt!) : Promise.reject(notFound()),
  resolveCname: (h) =>
    records.get(h)?.cname ? Promise.resolve(records.get(h)!.cname!) : Promise.reject(notFound()),
  resolve4: (h) =>
    records.get(h)?.a ? Promise.resolve(records.get(h)!.a!) : Promise.reject(notFound()),
};

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let B: TenantFixture;
let tokenA: string;
let tokenB: string;
const root = loadEnv().ROOT_DOMAIN;
const domain = `reservas-${Date.now()}.elbarbas.pe`;

const api = (token: string, slug: string) => ({
  get: () =>
    request(t.http)
      .get('/v1/shop/domain')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug),
  put: (d: string) =>
    request(t.http)
      .put('/v1/shop/domain')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send({ domain: d }),
  verify: () =>
    request(t.http)
      .post('/v1/shop/domain/verify')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug),
  del: () =>
    request(t.http)
      .delete('/v1/shop/domain')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug),
});

async function setPlan(shopId: string, customDomain: boolean) {
  const code = `dom-${customDomain}`;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, features, updated_at)
     VALUES ($1, $2, $2, 0, 0, $3, now()) ON CONFLICT (code) DO UPDATE SET features = EXCLUDED.features RETURNING id`,
    [randomUUID(), code, JSON.stringify({ customDomain })],
  );
  await owner.query('UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2', [
    rows[0]!.id,
    shopId,
  ]);
}

beforeAll(async () => {
  t = await createTestApp([], [{ provide: DNS_RESOLVER, useValue: fakeDns }]);
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'dom');
  B = await createTenant(owner, 'domb');
  await setPlan(A.barbershopId, true);
  await setPlan(B.barbershopId, false);
  tokenA = await t.tokenFor(A.ownerUserId);
  tokenB = await t.tokenFor(B.ownerUserId);
  records.set(`${A.slug}.${root}`, { a: ['203.0.113.10'] });
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('dominio propio', () => {
  let txtValue: string;

  it('sin dominio: estado "none"; el plan sin la función no puede agregar (402)', async () => {
    expect((await api(tokenA, A.slug).get().expect(200)).body).toMatchObject({
      domain: null,
      status: 'none',
      featureEnabled: true,
      defaultUrl: `https://${A.slug}.${root}`,
    });
    expect((await api(tokenB, B.slug).get().expect(200)).body.featureEnabled).toBe(false);
    await api(tokenB, B.slug).put('reservas.otra.pe').expect(402);
  });

  it('valida el dominio y da las instrucciones de DNS', async () => {
    const bad = await api(tokenA, A.slug).put(`x.${root}`).expect(400);
    expect(bad.body.errors[0].path).toBe('domain');
    await api(tokenA, A.slug).put('10.0.0.1').expect(400);
    const r = (await api(tokenA, A.slug).put(` https://${domain.toUpperCase()}/ `).expect(200))
      .body;
    expect(r).toMatchObject({ domain, status: 'pending' });
    expect(r.instructions.txt.name).toBe(`_cognira-verify.${domain}`);
    expect(r.instructions.point).toEqual({
      type: 'CNAME',
      name: domain,
      value: `${A.slug}.${root}`,
    });
    txtValue = r.instructions.txt.value as string;
  });

  it('otra barbería no puede tomar el mismo dominio (409)', async () => {
    await setPlan(B.barbershopId, true);
    await api(tokenB, B.slug).put(domain).expect(409);
  });

  it('verificar: sin registros queda pendiente con el motivo; con TXT y CNAME queda verificado', async () => {
    const pending = (await api(tokenA, A.slug).verify().expect(200)).body;
    expect(pending).toMatchObject({ status: 'pending', error: expect.stringMatching(/TXT/) });
    // No resuelve ni tiene certificado mientras no esté verificado.
    await request(t.http).get(`/v1/public/resolve-domain?host=${domain}`).expect(404);
    await request(t.http).get(`/v1/public/tls/ask?domain=${domain}`).expect(404);

    records.set(`_cognira-verify.${domain}`, { txt: [[txtValue]] });
    records.set(domain, { cname: [`${A.slug}.${root}.`] });
    const ok = (await api(tokenA, A.slug).verify().expect(200)).body;
    expect(ok).toMatchObject({ status: 'verified', error: null, verifiedAt: expect.any(String) });
  });

  it('verificado: resuelve a la barbería, Caddy puede emitir y CORS lo acepta', async () => {
    expect(
      (await request(t.http).get(`/v1/public/resolve-domain?host=${domain}`).expect(200)).body,
    ).toEqual({ slug: A.slug });
    await request(t.http).get(`/v1/public/tls/ask?domain=${domain}`).expect(200);
    const pre = await request(t.http)
      .options('/v1/public/legal')
      .set('Origin', `https://${domain}`)
      .set('Access-Control-Request-Method', 'GET');
    expect(pre.headers['access-control-allow-origin']).toBe(`https://${domain}`);
    const evil = await request(t.http)
      .options('/v1/public/legal')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('un barbero no gestiona el dominio; quitarlo deja de resolver', async () => {
    const barber = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'B', now())`,
      [barber, `${barber}@test.pe`],
    );
    await owner.query(
      `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
      [randomUUID(), A.barbershopId, barber],
    );
    await api(await t.tokenFor(barber), A.slug)
      .get()
      .expect(403);
    await api(tokenA, A.slug).del().expect(204);
    expect((await api(tokenA, A.slug).get().expect(200)).body.status).toBe('none');
    await request(t.http).get(`/v1/public/resolve-domain?host=${domain}`).expect(404);
  });
});
