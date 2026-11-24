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
let superToken: string;
let supportToken: string;
let userId: string;
const email = `manual-${Date.now()}@test.pe`;

async function createUser(role: 'superadmin' | 'support' | null) {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'U', $3, now())`,
    [id, `${id}@test.pe`, role],
  );
  return id;
}
const as = (token: string) => ({
  get: (u: string) => request(t.http).get(u).set('Authorization', `Bearer ${token}`),
  post: (u: string) => request(t.http).post(u).set('Authorization', `Bearer ${token}`),
});

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'manual');
  superToken = await t.tokenFor(await createUser('superadmin'));
  supportToken = await t.tokenFor(await createUser('support'));
  const r = await request(t.http)
    .post('/v1/auth/register')
    .send({ email, password: 'Clave-inicial-1', fullName: 'Dueño Manual', acceptTerms: true })
    .expect(201);
  userId = r.body.user.id as string;
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'admin', 'active', now())`,
    [randomUUID(), A.barbershopId, userId],
  );
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('cuentas: vía manual del superadmin', () => {
  it('la ficha de la barbería muestra si el correo está verificado', async () => {
    const d = (await as(superToken).get(`/v1/platform/barbershops/${A.barbershopId}`).expect(200))
      .body;
    const m = d.members.find((x: { email: string }) => x.email === email);
    expect(m).toMatchObject({ userId, emailVerified: false });
  });

  it('solo el superadmin puede verificar o generar enlaces', async () => {
    await as(supportToken).post(`/v1/platform/users/${userId}/verify-email`).expect(403);
    await as(supportToken).post(`/v1/platform/users/${userId}/reset-link`).expect(403);
    const ownerToken = await t.tokenFor(A.ownerUserId);
    await as(ownerToken).post(`/v1/platform/users/${userId}/reset-link`).expect(403);
    await as(superToken).post(`/v1/platform/users/${randomUUID()}/verify-email`).expect(404);
  });

  it('marcar el correo como verificado (idempotente)', async () => {
    const r = (await as(superToken).post(`/v1/platform/users/${userId}/verify-email`).expect(200))
      .body;
    expect(r.emailVerifiedAt).toEqual(expect.any(String));
    const again = (
      await as(superToken).post(`/v1/platform/users/${userId}/verify-email`).expect(200)
    ).body;
    expect(again.emailVerifiedAt).toBe(r.emailVerifiedAt);
    const d = (await as(superToken).get(`/v1/platform/barbershops/${A.barbershopId}`).expect(200))
      .body;
    expect(d.members.find((x: { email: string }) => x.email === email).emailVerified).toBe(true);
  });

  it('enlace de contraseña: sirve una vez y un enlace nuevo anula el anterior', async () => {
    const first = (await as(superToken).post(`/v1/platform/users/${userId}/reset-link`).expect(200))
      .body;
    expect(first).toMatchObject({ email, url: expect.stringContaining('/restablecer?token=') });
    const second = (
      await as(superToken).post(`/v1/platform/users/${userId}/reset-link`).expect(200)
    ).body;
    const token = (u: string) => new URL(u).searchParams.get('token')!;
    await request(t.http)
      .post('/v1/auth/password/reset')
      .send({ token: token(first.url as string), password: 'Clave-nueva-123' })
      .expect(400);
    await request(t.http)
      .post('/v1/auth/password/reset')
      .send({ token: token(second.url as string), password: 'Clave-nueva-123' })
      .expect(204);
    await request(t.http)
      .post('/v1/auth/login')
      .send({ email, password: 'Clave-nueva-123' })
      .expect(200);
    const { rows } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1 AND action = 'platform.user.reset_link'`,
      [userId],
    );
    expect(rows[0]!.n).toBe(2);
  });
});

describe('enlace de invitación del dueño (barbería creada desde la plataforma)', () => {
  it('genera el enlace, la dueña crea su cuenta y acepta; luego ya no aplica', async () => {
    const ownerEmail = `duena-${Date.now()}@test.pe`;
    const created = (
      await request(t.http)
        .post('/v1/platform/barbershops')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          name: 'Creada por plataforma',
          slug: `plat-${Date.now().toString(36)}`,
          ownerEmail,
          planCode: 'test-basic',
        })
        .expect(201)
    ).body;
    const detail = (await as(superToken).get(`/v1/platform/barbershops/${created.id}`).expect(200))
      .body;
    const member = detail.members.find((x: { email: string }) => x.email === ownerEmail);
    expect(member).toMatchObject({ role: 'owner', status: 'invited', userId: null });

    const path = `/v1/platform/barbershops/${created.id}/members/${member.id}/invite-link`;
    await as(supportToken).post(path).expect(403);
    const first = (await as(superToken).post(path).expect(200)).body;
    const link = (await as(superToken).post(path).expect(200)).body;
    expect(link).toMatchObject({ email: ownerEmail, url: expect.stringContaining('/invitacion/') });
    const tok = (u: string) => u.split('/invitacion/')[1]!;
    // El enlace anterior ya no sirve.
    await request(t.http)
      .get(`/v1/invitations/${tok(first.url as string)}`)
      .expect(404);

    const reg = await request(t.http)
      .post('/v1/auth/register')
      .send({ email: ownerEmail, password: 'Clave-duena-1', fullName: 'Dueña', acceptTerms: true })
      .expect(201);
    await request(t.http)
      .post(`/v1/invitations/${tok(link.url as string)}/accept`)
      .set('Authorization', `Bearer ${reg.body.accessToken as string}`)
      .expect(200);
    const after = (await as(superToken).get(`/v1/platform/barbershops/${created.id}`).expect(200))
      .body;
    expect(after.members.find((x: { email: string }) => x.email === ownerEmail).status).toBe(
      'active',
    );
    await as(superToken).post(path).expect(409);
  });
});
