/**
 * Escribe openapi.json sin levantar el servidor ni conectar a la BD.
 * El frontend lo consume con Orval: `pnpm api:gen` en barbersaas-web.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi } from './swagger';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: true });
  app.setGlobalPrefix('v1');
  const out = process.argv[2] ?? 'openapi.json';
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2) + '\n');
  await app.close();
  console.log(`OpenAPI escrito en ${out}`);
}

void main();
