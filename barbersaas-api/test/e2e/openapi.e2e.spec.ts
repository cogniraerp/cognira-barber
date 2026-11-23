/**
 * El documento OpenAPI es el contrato con barbersaas-web (Orval genera el cliente desde aquí).
 * Si un esquema Zod no es representable (p. ej. un .transform() en una respuesta), Swagger
 * revienta al arrancar: este test lo detecta antes.
 */
import { validate } from '@scalar/openapi-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../../src/swagger';
import { createTestApp, type TestApp } from '../support/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('OpenAPI', () => {
  it('se genera sin errores y cubre las áreas principales', () => {
    const doc = buildOpenApi(t.app);
    const paths = Object.keys(doc.paths);
    for (const p of [
      '/v1/auth/login',
      '/v1/me/barbershops',
      '/v1/shop/context',
      '/v1/shop/branding',
      '/v1/platform/barbershops',
    ]) {
      expect(paths).toContain(p);
    }
  });

  it('es un documento OpenAPI 3.0 válido (el mismo validador que usa Orval en el frontend)', async () => {
    const doc = buildOpenApi(t.app);
    expect(doc.openapi).toMatch(/^3\.0\./);
    const result = await validate(JSON.parse(JSON.stringify(doc)) as Record<string, unknown>);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('describe BIEN los tipos: un nullable es "T | null", nunca un array (bug visto con 3.1)', () => {
    const s = buildOpenApi(t.app).components!.schemas! as Record<string, { properties?: Record<string, Record<string, unknown>> }>;
    const prop = (schema: string, p: string) => s[schema]?.properties?.[p];
    expect(prop('CreateBarbershopResultDto_Output', 'inviteToken')).toMatchObject({ type: 'string', nullable: true });
    expect(prop('CustomerDto', 'phone')).toMatchObject({ type: 'string', nullable: true });
    expect(prop('CustomerDto', 'tags')).toMatchObject({ type: 'array' });
    // Ningún `type` con forma de lista (estilo 3.1) en todo el documento.
    const bad: string[] = [];
    const walk = (n: unknown, path: string) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray((n as { type?: unknown }).type)) bad.push(path);
      for (const [k, v] of Object.entries(n)) walk(v, `${path}/${k}`);
    };
    walk(s, '');
    expect(bad).toEqual([]);
  });

  it('todas las operaciones tienen operationId único (Orval los usa como nombre de hook)', () => {
    const doc = buildOpenApi(t.app);
    const ids = Object.values(doc.paths).flatMap((ops) =>
      Object.values(ops as Record<string, { operationId?: string }>).map((o) => o.operationId),
    );
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
