/**
 * PrismaService.run(): el contexto RLS se aplica a través del driver adapter y
 * NO se filtra a otras transacciones que reutilicen la misma conexión del pool.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { TEST_APP_URL, TEST_OWNER_URL } from '../support/test-env';

let prisma: PrismaService;
let owner: Client;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'pa');
  B = await createTenant(owner, 'pb');

  const env = loadEnv({
    ...process.env,
    DATABASE_URL: TEST_APP_URL,
    // Pool de 1 conexión: obliga a que todas las transacciones reutilicen la misma.
    DB_POOL_MAX: '1',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    ROOT_DOMAIN: 'barbersaas.localhost',
    WEB_URL: 'http://localhost:5173',
    PUBLIC_API_URL: 'http://localhost:3100',
  });
  prisma = new PrismaService(env);
  await prisma.$connect();
});

afterAll(async () => {
  await prisma?.$disconnect();
  await owner?.end();
});

describe('PrismaService.run', () => {
  it('filtra por la barbería del contexto', async () => {
    const services = await prisma.run({ kind: 'tenant', barbershopId: A.barbershopId }, (tx) =>
      tx.service.findMany({ select: { barbershopId: true } }),
    );
    expect(services.length).toBeGreaterThan(0);
    expect(new Set(services.map((s) => s.barbershopId))).toEqual(new Set([A.barbershopId]));
  });

  it('el contexto no se filtra a la siguiente transacción en la misma conexión', async () => {
    await prisma.run({ kind: 'tenant', barbershopId: A.barbershopId }, (tx) => tx.service.count());
    // Sin contexto → deny by default
    expect(await prisma.service.count()).toBe(0);
    // Otro tenant en la misma conexión → solo lo suyo
    const ids = await prisma.run({ kind: 'tenant', barbershopId: B.barbershopId }, (tx) =>
      tx.service.findMany({ select: { barbershopId: true } }),
    );
    expect(new Set(ids.map((s) => s.barbershopId))).toEqual(new Set([B.barbershopId]));
  });

  it('transacciones concurrentes con contextos distintos no se mezclan', async () => {
    const runs = Array.from({ length: 10 }, (_, i) => {
      const shop = i % 2 === 0 ? A : B;
      return prisma
        .run({ kind: 'tenant', barbershopId: shop.barbershopId }, (tx) =>
          tx.customer.findMany({ select: { barbershopId: true } }),
        )
        .then((rows) => ({
          expected: shop.barbershopId,
          got: [...new Set(rows.map((r) => r.barbershopId))],
        }));
    });
    for (const r of await Promise.all(runs)) expect(r.got).toEqual([r.expected]);
  });

  it('si fn lanza un error, la transacción hace rollback', async () => {
    await expect(
      prisma.run({ kind: 'tenant', barbershopId: A.barbershopId }, async (tx) => {
        await tx.service.update({ where: { id: A.serviceId }, data: { name: 'Rollback' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const svc = await prisma.run({ kind: 'tenant', barbershopId: A.barbershopId }, (tx) =>
      tx.service.findUniqueOrThrow({ where: { id: A.serviceId } }),
    );
    expect(svc.name).toBe('Corte');
  });
});
