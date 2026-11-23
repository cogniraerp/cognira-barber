import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
const email = `ana-${Date.now()}@test.pe`;
const password = 'Sup3r-secreta';

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('POST /v1/auth/register', () => {
  it('crea la cuenta y devuelve tokens (email normalizado)', async () => {
    const res = await request(t.http)
      .post('/v1/auth/register')
      .send({
        email: `  ${email.toUpperCase()} `,
        password,
        fullName: 'Ana Pérez',
        acceptTerms: true,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: expect.any(Number),
      user: { email, fullName: 'Ana Pérez', platformRole: null },
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it('guarda la contraseña con argon2id, nunca en claro', async () => {
    const { rows } = await owner.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [email],
    );
    expect(rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('email duplicado → 409', async () => {
    const res = await request(t.http)
      .post('/v1/auth/register')
      .send({ email, password, fullName: 'Otra Ana', acceptTerms: true })
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('datos inválidos → 400 con detalle por campo', async () => {
    const res = await request(t.http)
      .post('/v1/auth/register')
      .send({ email: 'no-es-email', password: '123', fullName: 'A', acceptTerms: true })
      .expect(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'email',
      'fullName',
      'password',
    ]);
  });
});

describe('POST /v1/auth/login', () => {
  it('credenciales correctas → tokens y auditoría con IP', async () => {
    const res = await request(t.http).post('/v1/auth/login').send({ email, password }).expect(200);
    expect(res.body.user.email).toBe(email);
    const { rows } = await owner.query<{ ip: string | null }>(
      `SELECT a.ip FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
       WHERE u.email = $1 AND a.action = 'auth.login'`,
      [email],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.ip).toBeTruthy();
  });

  it('contraseña incorrecta y email inexistente dan el mismo error', async () => {
    const a = await request(t.http)
      .post('/v1/auth/login')
      .send({ email, password: 'mala-mala' })
      .expect(401);
    const b = await request(t.http)
      .post('/v1/auth/login')
      .send({ email: 'nadie@test.pe', password: 'mala-mala' })
      .expect(401);
    expect(a.body.title).toBe(b.body.title);
    expect(a.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('access token', () => {
  it('GET /v1/me con token → perfil', async () => {
    const { body } = await request(t.http).post('/v1/auth/login').send({ email, password });
    const me = await request(t.http)
      .get('/v1/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email, platformRole: null, locale: 'es-PE' });
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('sin token o con token manipulado → 401', async () => {
    await request(t.http).get('/v1/me').expect(401);
    const { body } = await request(t.http).post('/v1/auth/login').send({ email, password });
    const tampered = body.accessToken.slice(0, -3) + 'abc';
    await request(t.http).get('/v1/me').set('Authorization', `Bearer ${tampered}`).expect(401);
  });

  it('PATCH /v1/me ignora platformRole (no se puede auto-promover)', async () => {
    const { body } = await request(t.http).post('/v1/auth/login').send({ email, password });
    const res = await request(t.http)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ fullName: 'Ana P.', platformRole: 'superadmin' })
      .expect(200);
    expect(res.body).toMatchObject({ fullName: 'Ana P.', platformRole: null });
  });
});

describe('refresh tokens', () => {
  it('rotan: el nuevo funciona, el viejo ya no', async () => {
    const login = await request(t.http).post('/v1/auth/login').send({ email, password });
    const r1 = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(r1.body.refreshToken).not.toBe(login.body.refreshToken);
    await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(200);
  });

  it('reutilizar un refresh ya usado revoca TODAS las sesiones de esa cadena', async () => {
    const login = await request(t.http).post('/v1/auth/login').send({ email, password });
    const r1 = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    // Un atacante reutiliza el token original…
    await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    // …y el token legítimo más reciente también queda revocado.
    await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('logout revoca el refresh token', async () => {
    const login = await request(t.http).post('/v1/auth/login').send({ email, password });
    await request(t.http)
      .post('/v1/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);
    await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('refresh inventado → 401', async () => {
    await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'x'.repeat(43) })
      .expect(401);
  });
});

describe('rate limiting', () => {
  it('más de 10 intentos de login por minuto → 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request(t.http).post('/v1/auth/login').send({ email, password: 'mala-mala' });
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
    const last = await request(t.http).post('/v1/auth/login').send({ email, password });
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');
  });
});
