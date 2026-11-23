import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { S3StorageProvider } from '../../src/infra/storage/s3-storage.provider';
import { StorageProvider } from '../../src/infra/storage/storage.provider';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

/**
 * STORAGE_DRIVER=s3 contra un S3 real en local (adobe/s3mock del docker compose, perfil "s3").
 * Si no está arriba, la suite se salta con un aviso: `docker compose --profile s3 up -d s3`.
 */
const S3_URL = process.env.S3_TEST_ENDPOINT ?? 'http://localhost:59000';
/** Se decide en beforeAll (el proyecto es CommonJS: sin await de nivel superior). */
let reachable = false;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let token: string;

describe('storage S3 (R2/S3 compatible)', () => {
  beforeAll(async () => {
    reachable = await fetch(S3_URL, { signal: AbortSignal.timeout(1500) })
      .then(() => true)
      .catch(() => false);
    if (!reachable) {
      console.warn(
        `[storage-s3] ${S3_URL} no responde: se omite (docker compose --profile s3 up -d s3)`,
      );
      return;
    }
    const env = {
      ...loadEnv(),
      STORAGE_DRIVER: 's3' as const,
      S3_ENDPOINT: S3_URL,
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'media',
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_PUBLIC_URL: `${S3_URL}/media`,
      S3_FORCE_PATH_STYLE: true,
    };
    t = await createTestApp(
      [],
      [{ provide: StorageProvider, useValue: new S3StorageProvider(env) }],
    );
    owner = new Client({ connectionString: TEST_OWNER_URL });
    await owner.connect();
    A = await createTenant(owner, 's3');
    token = await t.tokenFor(A.ownerUserId);
  });

  afterAll(async () => {
    await t?.close();
    await owner?.end();
  });

  const upload = () =>
    request(t.http)
      .post('/v1/shop/uploads?kind=logo')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', A.slug)
      .attach('file', PNG, 'logo.png');

  it('sube al bucket; la URL pública sirve la imagen con su tipo y caché larga', async (ctx) => {
    if (!reachable) ctx.skip();
    const r = await upload().expect(201);
    expect(r.body.url).toBe(`${S3_URL}/media/${r.body.key as string}`);
    const file = await fetch(r.body.url as string);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.compare(Buffer.from(await file.arrayBuffer()), PNG)).toBe(0);
  });

  it('la imagen del bucket se acepta como propia de la barbería; una ajena no', async (ctx) => {
    if (!reachable) ctx.skip();
    const r = await upload().expect(201);
    await request(t.http)
      .patch('/v1/shop/branding')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', A.slug)
      .send({ logoUrl: r.body.url })
      .expect(200);
    await request(t.http)
      .patch('/v1/shop/branding')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', A.slug)
      .send({ logoUrl: `${S3_URL}/media/otra-barberia/logo/x.png` })
      .expect(400);
  });

  it('borrar el archivo lo quita del bucket', async (ctx) => {
    if (!reachable) ctx.skip();
    const r = await upload().expect(201);
    await request(t.http)
      .delete(`/v1/shop/uploads/${r.body.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', A.slug)
      .expect(204);
    expect((await fetch(r.body.url as string)).status).toBe(404);
  });
});
