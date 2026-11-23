import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

/**
 * OpenAPI 3.0. Zod 4 emite algunos nullables anidados al estilo 3.1 (`type: [T, 'null']`), que en
 * 3.0 son inválidos; `normalizeNullables` los pasa a `type: T, nullable: true`.
 * Las propiedades de primer nivel llegan con el tipo original en `x-original-type` gracias al parche
 * de nestjs-zod: sin él, @nestjs/swagger interpreta `type: [T, 'null']` como "array de T" y el
 * contrato queda mal aunque sea "válido" (lo verifica test/e2e/openapi.e2e.spec.ts).
 */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BarberSaaS API')
    .setDescription('API REST multi-tenant de BarberSaaS. Las rutas /v1/shop/* requieren el header X-Tenant-Slug.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Tenant-Slug', description: 'Slug de la barbería (p. ej. barberia-demo)' }, 'tenant')
    .build();
  return normalizeNullables(cleanupOpenApiDoc(SwaggerModule.createDocument(app, config), { version: '3.0' }));
}

export function normalizeNullables<T>(node: T): T {
  if (Array.isArray(node)) return node.map(normalizeNullables) as T;
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = normalizeNullables(v);
  // Tipo original que conservó el parche de nestjs-zod (patches/nestjs-zod@5.5.0.patch).
  if (Array.isArray(out['x-original-type'])) out.type = out['x-original-type'];
  delete out['x-original-type'];
  const t = out.type;
  if (Array.isArray(t) && t.includes('null')) {
    const rest = t.filter((x) => x !== 'null');
    if (rest.length === 1) out.type = rest[0];
    else delete out.type;
    out.nullable = true;
  }
  return out as T;
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApi(app), {
    jsonDocumentUrl: 'docs/openapi.json',
    customSiteTitle: 'BarberSaaS API',
    // Recuerda el token y el slug al recargar la página.
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', docExpansion: 'none', filter: true },
  });
}
