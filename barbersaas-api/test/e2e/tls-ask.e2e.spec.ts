import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let A: TenantFixture;
const root = loadEnv().ROOT_DOMAIN;
const ask = (domain: string) =>
  request(t.http).get(`/v1/public/tls/ask?domain=${encodeURIComponent(domain)}`);

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'tls');
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('GET /public/tls/ask (Caddy on-demand TLS)', () => {
  it('emite para la plataforma y para barberías que existen', async () => {
    await ask(root).expect(200);
    await ask(`app.${root}`).expect(200);
    await ask(`${A.slug}.${root}`).expect(200);
  });

  it('no emite para barberías inexistentes, borradas u otros dominios', async () => {
    await ask(`no-existe-zzz.${root}`).expect(404);
    await ask('evil.example.com').expect(404);
    await ask('').expect(404);
    await owner.query('UPDATE barbershops SET deleted_at = now() WHERE id = $1', [A.barbershopId]);
    await ask(`${A.slug}.${root}`).expect(404);
  });
});
