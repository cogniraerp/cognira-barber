import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SenderRegistry } from '../../src/modules/notifications/sender-registry';
import type { OutgoingMessage } from '../../src/modules/notifications/providers/types';
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
let superToken: string;
let supportToken: string;
const outbox: OutgoingMessage[] = [];
const flush = () => new Promise((r) => setTimeout(r, 20));
const year = new Date(Date.now() - 5 * 3600_000).getUTCFullYear();

async function createUser(role: 'superadmin' | 'support' | null) {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'U', $3, now())`,
    [id, `${id}@test.pe`, role],
  );
  return id;
}

const shopApi = (token: string, slug: string) => ({
  get: (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug),
  post: (u: string, b?: object) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
});
const asUser = (token: string) => ({
  get: (u: string) => request(t.http).get(u).set('Authorization', `Bearer ${token}`),
  post: (u: string, b?: object) =>
    request(t.http).post(u).set('Authorization', `Bearer ${token}`).send(b),
});

const sheet = (over: Record<string, unknown> = {}) => ({
  kind: 'reclamo',
  consumerName: 'Rosa Quispe',
  docType: 'DNI',
  docNumber: '12345678',
  consumerAddress: 'Av. Arequipa 123, Lima',
  consumerPhone: '987654321',
  consumerEmail: 'rosa@test.pe',
  itemType: 'servicio',
  itemDescription: 'Corte clásico',
  amountCents: 3500,
  detail: 'Pagué el adelanto y no me atendieron a la hora.',
  request: 'Devolución del adelanto',
  ...over,
});

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'lr');
  B = await createTenant(owner, 'lrb');
  await owner.query(
    `UPDATE barbershops SET legal_name = 'Barbería A S.A.C.', tax_id = '20123456789' WHERE id = $1`,
    [A.barbershopId],
  );
  tokenA = await t.tokenFor(A.ownerUserId);
  tokenB = await t.tokenFor(B.ownerUserId);
  const barber = await createUser(null);
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [randomUUID(), A.barbershopId, barber],
  );
  barberToken = await t.tokenFor(barber);
  superToken = await t.tokenFor(await createUser('superadmin'));
  supportToken = await t.tokenFor(await createUser('support'));
  vi.spyOn(t.app.get(SenderRegistry), 'email').mockReturnValue({
    name: 'test',
    send: (m: OutgoingMessage) => {
      outbox.push(m);
      return Promise.resolve({ status: 'sent' as const, providerMessageId: null });
    },
  });
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('Libro de Reclamaciones de la barbería', () => {
  let firstId: string;

  it('la página pública muestra los datos del proveedor', async () => {
    const r = await request(t.http).get(`/v1/public/shops/${A.slug}/complaints-book`).expect(200);
    expect(r.body).toMatchObject({ legalName: 'Barbería A S.A.C.', taxId: '20123456789' });
    await request(t.http).get('/v1/public/shops/no-existe-xyz/complaints-book').expect(404);
  });

  it('registra la hoja con correlativo, copia al consumidor y aviso al dueño', async () => {
    const r1 = await request(t.http)
      .post(`/v1/public/shops/${A.slug}/complaints`)
      .send(sheet())
      .expect(201);
    expect(r1.body.code).toBe(`N° 000001-${year}`);
    expect(new Date(r1.body.dueAt as string).getTime()).toBeGreaterThan(
      Date.now() + 14 * 86_400_000,
    );
    firstId = r1.body.id as string;
    const r2 = await request(t.http)
      .post(`/v1/public/shops/${A.slug}/complaints`)
      .send(sheet({ kind: 'queja', consumerEmail: 'luis@test.pe', amountCents: undefined }))
      .expect(201);
    expect(r2.body.code).toBe(`N° 000002-${year}`);
    // El libro de B empieza en 1: el correlativo es por libro.
    const rb = await request(t.http)
      .post(`/v1/public/shops/${B.slug}/complaints`)
      .send(sheet())
      .expect(201);
    expect(rb.body.code).toBe(`N° 000001-${year}`);
    await flush();
    const copy = outbox.find(
      (m) =>
        m.to === 'rosa@test.pe' &&
        m.subject?.includes('000001') &&
        m.body.includes('RUC 20123456789'),
    );
    expect(copy?.body).toContain('INDECOPI');
    expect(
      outbox.some(
        (m) =>
          m.subject?.startsWith('Nuevo reclamo') && m.body.includes('/configuracion/reclamaciones'),
      ),
    ).toBe(true);
  });

  it('valida documento, menor de edad y slug', async () => {
    const bad = await request(t.http)
      .post(`/v1/public/shops/${A.slug}/complaints`)
      .send(sheet({ docNumber: '123' }))
      .expect(400);
    expect(bad.body.errors[0].path).toBe('docNumber');
    const minor = await request(t.http)
      .post(`/v1/public/shops/${A.slug}/complaints`)
      .send(sheet({ isMinor: true }))
      .expect(400);
    expect(minor.body.errors[0].path).toBe('guardianName');
    await request(t.http)
      .post('/v1/public/shops/no-existe-xyz/complaints')
      .send(sheet())
      .expect(404);
  });

  it('el dueño ve su libro; el barbero no; B no ve el de A', async () => {
    const list = (await shopApi(tokenA, A.slug).get('/v1/shop/complaints').expect(200)).body;
    expect(list).toMatchObject({ total: 2, pendingCount: 2, overdueCount: 0 });
    expect(list.items[0]).toMatchObject({
      code: `N° 000002-${year}`,
      kind: 'queja',
      status: 'pending',
      overdue: false,
    });
    await shopApi(barberToken, A.slug).get('/v1/shop/complaints').expect(403);
    expect((await shopApi(tokenB, B.slug).get('/v1/shop/complaints').expect(200)).body.total).toBe(
      1,
    );
    await shopApi(tokenB, B.slug)
      .post(`/v1/shop/complaints/${firstId}/respond`, { response: 'Intento responder lo ajeno.' })
      .expect(404);
  });

  it('responder: valida, envía la respuesta al consumidor y no se responde dos veces', async () => {
    await shopApi(tokenA, A.slug)
      .post(`/v1/shop/complaints/${firstId}/respond`, { response: 'ok' })
      .expect(400);
    const r = await shopApi(tokenA, A.slug)
      .post(`/v1/shop/complaints/${firstId}/respond`, {
        response: 'Lamentamos lo ocurrido. Te devolvimos el adelanto a tu tarjeta.',
      })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'answered', respondedAt: expect.any(String) });
    await flush();
    expect(outbox.at(-1)).toMatchObject({ to: 'rosa@test.pe' });
    expect(outbox.at(-1)!.body).toContain('Te devolvimos el adelanto');
    await shopApi(tokenA, A.slug)
      .post(`/v1/shop/complaints/${firstId}/respond`, { response: 'Otra respuesta más larga.' })
      .expect(409);
    const pending = (
      await shopApi(tokenA, A.slug).get('/v1/shop/complaints?status=pending').expect(200)
    ).body;
    expect(pending.total).toBe(1);
  });

  it('una hoja vencida sin responder se marca', async () => {
    await owner.query(
      `UPDATE complaints SET due_at = now() - interval '1 hour' WHERE barbershop_id = $1 AND status = 'pending'`,
      [A.barbershopId],
    );
    const list = (await shopApi(tokenA, A.slug).get('/v1/shop/complaints').expect(200)).body;
    expect(list.overdueCount).toBe(1);
    expect(list.items.find((x: { status: string }) => x.status === 'pending').overdue).toBe(true);
  });
});

describe('Libro de Reclamaciones de Cognira', () => {
  let id: string;

  it('datos legales públicos y hoja con su propio correlativo', async () => {
    expect((await request(t.http).get('/v1/public/legal').expect(200)).body.tradeName).toEqual(
      expect.any(String),
    );
    const before = (await asUser(superToken).get('/v1/platform/complaints').expect(200)).body
      .total as number;
    const r = await request(t.http)
      .post('/v1/public/complaints')
      .send(sheet({ itemDescription: 'Suscripción Pro' }))
      .expect(201);
    expect(r.body.code).toBe(`N° ${String(before + 1).padStart(6, '0')}-${year}`);
    id = r.body.id as string;
  });

  it('solo la plataforma lo ve; soporte lee pero no responde; las barberías no lo ven', async () => {
    const list = (await asUser(supportToken).get('/v1/platform/complaints').expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toContain(id);
    await asUser(supportToken)
      .post(`/v1/platform/complaints/${id}/respond`, { response: 'Soporte no puede.' })
      .expect(403);
    const shopList = (await shopApi(tokenA, A.slug).get('/v1/shop/complaints').expect(200)).body;
    expect(shopList.items.map((x: { id: string }) => x.id)).not.toContain(id);
    await shopApi(tokenA, A.slug)
      .post(`/v1/shop/complaints/${id}/respond`, { response: 'No es mío pero lo intento.' })
      .expect(404);
    await asUser(tokenA).get('/v1/platform/complaints').expect(403);
  });

  it('el superadmin responde', async () => {
    const r = await asUser(superToken)
      .post(`/v1/platform/complaints/${id}/respond`, {
        response: 'Revisamos tu cobro y lo corregimos.',
      })
      .expect(200);
    expect(r.body.status).toBe('answered');
  });
});

describe('consentimiento al registrarse (Ley 29733)', () => {
  it('sin aceptar los términos → 400; aceptándolos queda la fecha', async () => {
    const email = `terms-${Date.now()}@test.pe`;
    const bad = await request(t.http)
      .post('/v1/auth/register')
      .send({ email, password: 'Clave-segura1', fullName: 'Sin Aceptar' })
      .expect(400);
    expect(bad.body.errors[0].path).toBe('acceptTerms');
    await request(t.http)
      .post('/v1/auth/register')
      .send({ email, password: 'Clave-segura1', fullName: 'Acepta', acceptTerms: true })
      .expect(201);
    const { rows } = await owner.query<{ terms_accepted_at: Date | null }>(
      'SELECT terms_accepted_at FROM users WHERE email = $1',
      [email],
    );
    expect(rows[0]!.terms_accepted_at).toBeInstanceOf(Date);
  });
});
