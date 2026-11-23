import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SenderRegistry } from '../../src/modules/notifications/sender-registry';
import type { OutgoingMessage } from '../../src/modules/notifications/providers/types';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_APP_URL, TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
const outbox: OutgoingMessage[] = [];
const email = `rec-${Date.now()}@test.pe`;
const password = 'Primera-clave1';

/** Token del último correo enviado a `to` cuyo link contiene `path`. */
function tokenFrom(to: string, path: string): string {
  const msg = [...outbox].reverse().find((m) => m.to === to && m.body.includes(path));
  const m = msg?.body.match(new RegExp(`${path}\\?token=([\\w-]+)`));
  if (!m) throw new Error(`No hay correo con ${path} para ${to}`);
  return m[1]!;
}
/** Los envíos van en segundo plano: deja correr la cola de microtareas. */
const flush = () => new Promise((r) => setTimeout(r, 20));
/** Permite pedir otro link sin esperar el minuto de espera. */
const skipCooldown = () =>
  owner.query(
    `UPDATE auth_tokens SET created_at = created_at - interval '2 minutes'
     WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email],
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
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

const login = (pw: string) => request(t.http).post('/v1/auth/login').send({ email, password: pw });

describe('verificar correo', () => {
  let access: string;

  it('al registrarse llega el link y /me dice que falta verificar', async () => {
    const r = await request(t.http)
      .post('/v1/auth/register')
      .send({ email, password, fullName: 'Rosa Quispe', acceptTerms: true })
      .expect(201);
    access = r.body.accessToken as string;
    await flush();
    expect(tokenFrom(email, '/verificar-correo')).toBeTruthy();
    const me = await request(t.http).get('/v1/me').set('Authorization', `Bearer ${access}`);
    expect(me.body.emailVerifiedAt).toBeNull();
  });

  it('reenviar: 429 dentro del minuto; luego manda un link nuevo', async () => {
    await request(t.http)
      .post('/v1/me/email/resend-verification')
      .set('Authorization', `Bearer ${access}`)
      .expect(429);
    await skipCooldown();
    const before = outbox.length;
    await request(t.http)
      .post('/v1/me/email/resend-verification')
      .set('Authorization', `Bearer ${access}`)
      .expect(204);
    await flush();
    expect(outbox.length).toBe(before + 1);
    await request(t.http).post('/v1/me/email/resend-verification').expect(401);
  });

  it('el link verifica; abrirlo otra vez no falla; token falso → 400; luego reenviar → 409', async () => {
    const token = tokenFrom(email, '/verificar-correo');
    await request(t.http).post('/v1/auth/email/verify').send({ token }).expect(204);
    await request(t.http).post('/v1/auth/email/verify').send({ token }).expect(204);
    const bad = await request(t.http)
      .post('/v1/auth/email/verify')
      .send({ token: 'x'.repeat(43) })
      .expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/no es válido/);
    const me = await request(t.http).get('/v1/me').set('Authorization', `Bearer ${access}`);
    expect(me.body.emailVerifiedAt).toEqual(expect.any(String));
    await request(t.http)
      .post('/v1/me/email/resend-verification')
      .set('Authorization', `Bearer ${access}`)
      .expect(409);
  });
});

describe('recuperar contraseña', () => {
  it('correo inexistente → 204 igual y no se envía nada', async () => {
    const before = outbox.length;
    await request(t.http)
      .post('/v1/auth/password/forgot')
      .send({ email: 'nadie-aqui@test.pe' })
      .expect(204);
    await flush();
    expect(outbox.length).toBe(before);
    await request(t.http)
      .post('/v1/auth/password/forgot')
      .send({ email: 'no-es-correo' })
      .expect(400);
  });

  it('pedir → link; un segundo pedido inmediato no manda otro correo', async () => {
    await skipCooldown();
    const before = outbox.length;
    await request(t.http)
      .post('/v1/auth/password/forgot')
      .send({ email: email.toUpperCase() })
      .expect(204);
    await request(t.http).post('/v1/auth/password/forgot').send({ email }).expect(204);
    await flush();
    expect(outbox.length).toBe(before + 1);
    expect(outbox.at(-1)!.subject).toMatch(/Restablece/);
  });

  it('restablecer: valida la clave, cambia la contraseña, cierra sesiones y el link no sirve dos veces', async () => {
    const session = (await login(password).expect(200)).body as { refreshToken: string };
    const token = tokenFrom(email, '/restablecer');
    await request(t.http)
      .post('/v1/auth/password/reset')
      .send({ token, password: 'corta' })
      .expect(400);
    await request(t.http)
      .post('/v1/auth/password/reset')
      .send({ token, password: 'Nueva-clave-99' })
      .expect(204);
    await flush();
    expect(outbox.at(-1)!.subject).toMatch(/cambió/);
    // Sesiones previas revocadas; la clave vieja ya no entra, la nueva sí.
    await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    await login(password).expect(401);
    await login('Nueva-clave-99').expect(200);
    const again = await request(t.http)
      .post('/v1/auth/password/reset')
      .send({ token, password: 'Otra-clave-123' })
      .expect(400);
    expect(JSON.stringify(again.body)).toMatch(/ya se usó/);
  });

  it('un link vencido no sirve', async () => {
    await skipCooldown();
    await request(t.http).post('/v1/auth/password/forgot').send({ email }).expect(204);
    await flush();
    const token = tokenFrom(email, '/restablecer');
    await owner.query(
      `UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL AND kind = 'password_reset'`,
    );
    const r = await request(t.http)
      .post('/v1/auth/password/reset')
      .send({ token, password: 'Otra-clave-123' })
      .expect(400);
    expect(JSON.stringify(r.body)).toMatch(/venció/);
  });

  it('la API no puede leer auth_tokens fuera del contexto del sistema (RLS)', async () => {
    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    try {
      const { rows } = await app.query('SELECT count(*)::int AS n FROM auth_tokens');
      expect(rows[0].n).toBe(0);
    } finally {
      await app.end();
    }
  });
});
