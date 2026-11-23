/** BD de tests: misma instancia de docker-compose, base de datos `barbersaas_test`. */
export const TEST_OWNER_URL =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:55432/barbersaas_test';

/** Usuario de runtime (miembro de barbersaas_app, sometido a RLS). */
export const TEST_APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://barbersaas_api:barbersaas_api@localhost:55432/barbersaas_test';
