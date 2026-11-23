import 'reflect-metadata';
import 'dotenv/config';
import { Logger, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { WorkerModule } from './worker/worker.module';
import { loadEnv, logLevels, type Env } from './config/env';
import { buildCorsOptions } from './common/http/cors';
import { setupSwagger } from './swagger';
import { FILES_ROUTE } from './infra/storage/local-storage.provider';
import { SentryLogger, initSentry } from './infra/monitoring/sentry';
import { DomainRegistry } from './modules/domains/domain-registry';

/** Configuración HTTP compartida entre el arranque real y los tests e2e. */
export function configureApp(app: INestApplication, env: Env): void {
  // IP real del cliente (X-Forwarded-For) solo de los proxies de confianza.
  if (env.TRUST_PROXY > 0) (app as NestExpressApplication).set('trust proxy', env.TRUST_PROXY);
  app.setGlobalPrefix('v1', { exclude: ['docs', 'docs/{*path}'] });
  // cross-origin: las imágenes de /files se muestran desde el dominio del frontend.
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }),
  );
  if (env.STORAGE_DRIVER === 'local') {
    (app as NestExpressApplication).useStaticAssets(resolve(env.STORAGE_LOCAL_DIR), {
      prefix: FILES_ROUTE,
      maxAge: '365d',
      immutable: true, // las keys son UUID: un archivo nunca cambia
      index: false,
      dotfiles: 'deny',
      setHeaders: (res: ServerResponse) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    });
  }
  const domains = app.get(DomainRegistry, { strict: false });
  app.enableCors(
    buildCorsOptions(
      env.ROOT_DOMAIN,
      env.CORS_ORIGINS,
      async (host) => !!(await domains.slugFor(host)),
    ),
  );
  app.enableShutdownHooks();
  if (env.SWAGGER_ENABLED) setupSwagger(app);
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new SentryLogger(logLevels(env.LOG_LEVEL), initSentry(env));

  if (env.APP_MODE === 'worker') {
    const worker = await NestFactory.createApplicationContext(WorkerModule, { logger });
    worker.enableShutdownHooks();
    return;
  }

  // rawBody: necesario para verificar la firma de los webhooks de Meta.
  const app = await NestFactory.create(AppModule, { logger, rawBody: true });
  configureApp(app, env);
  await app.listen(env.PORT);
  Logger.log(`API en http://localhost:${env.PORT}/v1 · Swagger en /docs`, 'Bootstrap');
}

if (require.main === module) {
  void bootstrap();
}
