import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_APP_URL } from './test-env';

// Variables para levantar la app en los tests e2e (no dependen del .env local).
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_APP_URL,
  LOG_LEVEL: 'error',
  AUTH_PROVIDER: 'local',
  JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
  JWT_ISSUER: 'barbersaas-test',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ROOT_DOMAIN: 'barbersaas.localhost',
  WEB_URL: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:3100',
  SWAGGER_ENABLED: 'false',
  PUBLIC_BOOKINGS_PER_HOUR: '1000',
  AUTH_RATE_LIMIT_PER_MINUTE: '10', // el test de rate limiting espera el valor de producción
  META_APP_SECRET: 'test-meta-app-secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: join(tmpdir(), 'barbersaas-test-storage'),
});
