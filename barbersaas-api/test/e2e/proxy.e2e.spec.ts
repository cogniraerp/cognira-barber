import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

/** Detrás de Caddy (TRUST_PROXY=1) la IP del cliente sale de X-Forwarded-For; sin proxy, no se cree. */
let owner: Client;
const lastLoginIp = async (email: string) => {
  const { rows } = await owner.query<{ ip: string | null }>(
    `SELECT a.ip FROM audit_logs a JOIN users u ON u.id = a.actor_user_id
     WHERE u.email = $1 AND a.action = 'auth.register' ORDER BY a.created_at DESC LIMIT 1`,
    [email],
  );
  return rows[0]?.ip ?? null;
};

async function registerVia(t: TestApp, forwardedFor: string) {
  const email = `proxy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.pe`;
  await request(t.http)
    .post('/v1/auth/register')
    .set('X-Forwarded-For', forwardedFor)
    .send({ email, password: 'Clave-proxy-1', fullName: 'Proxy Test', acceptTerms: true })
    .expect(201);
  return lastLoginIp(email);
}

beforeAll(async () => {
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
});
afterAll(async () => {
  await owner?.end();
  delete process.env.TRUST_PROXY;
});

describe('IP real detrás del proxy', () => {
  it('con TRUST_PROXY=1 usa la IP que envía Caddy', async () => {
    process.env.TRUST_PROXY = '1';
    const t = await createTestApp();
    try {
      expect(await registerVia(t, '203.0.113.7')).toBe('203.0.113.7');
    } finally {
      await t.close();
    }
  });

  it('sin proxy de confianza ignora X-Forwarded-For (no se puede falsificar la IP)', async () => {
    delete process.env.TRUST_PROXY;
    const t = await createTestApp();
    try {
      expect(await registerVia(t, '203.0.113.7')).not.toBe('203.0.113.7');
    } finally {
      await t.close();
    }
  });
});
