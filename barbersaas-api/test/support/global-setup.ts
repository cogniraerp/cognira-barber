import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { TEST_OWNER_URL } from './test-env';

/**
 * Deja la BD de tests vacía y aplica todas las migraciones (incluida la de RLS).
 * Por seguridad, se niega a correr contra una BD cuyo nombre no termine en `_test`.
 */
export default async function setup(): Promise<void> {
  const dbName = new URL(TEST_OWNER_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Los tests e2e solo corren contra una BD *_test (recibido: "${dbName}")`);
  }

  const client = new Client({ connectionString: TEST_OWNER_URL });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      DROP SCHEMA IF EXISTS app CASCADE;
      CREATE SCHEMA public;
    `);
  } finally {
    await client.end();
  }

  execSync('pnpm prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, MIGRATION_DATABASE_URL: TEST_OWNER_URL },
  });
}
