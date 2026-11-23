import { describe, expect, it } from 'vitest';
import { loadEnv, logLevels } from '../../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ROOT_DOMAIN: 'barbersaas.localhost',
  WEB_URL: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:3100',
};

describe('loadEnv', () => {
  it('aplica valores por defecto', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(3100);
    expect(env.AUTH_PROVIDER).toBe('local');
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  const legal = {
    LEGAL_NAME: 'Cognira S.A.C.',
    LEGAL_RUC: '20123456789',
    LEGAL_ADDRESS: 'Av. Prueba 123, Lima',
    LEGAL_EMAIL: 'legal@cognira.pe',
  };

  it('desactiva Swagger por defecto en producción', () => {
    expect(loadEnv({ ...base, ...legal, NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
  });

  it('en producción exige los datos legales (Libro de Reclamaciones)', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/LEGAL_RUC/);
    expect(() => loadEnv({ ...base, ...legal, LEGAL_RUC: '123' })).toThrow(/LEGAL_RUC/);
  });

  it('con STORAGE_DRIVER=s3 exige bucket, claves y URL pública', () => {
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('falla con un mensaje claro si la clave de cifrado no es de 32 bytes', () => {
    expect(() => loadEnv({ ...base, ENCRYPTION_KEY: 'corta' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('separa CORS_ORIGINS por comas', () => {
    expect(loadEnv({ ...base, CORS_ORIGINS: 'http://a.com, http://b.com' }).CORS_ORIGINS).toEqual([
      'http://a.com',
      'http://b.com',
    ]);
  });
});

describe('logLevels', () => {
  it('es acumulativo', () => {
    expect(logLevels('log')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(logLevels('debug')).toContain('log');
    expect(logLevels('error')).toEqual(['fatal', 'error']);
  });
});
