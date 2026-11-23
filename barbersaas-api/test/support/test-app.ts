import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/common/auth/token.service';
import { loadEnv } from '../../src/config/env';
import { configureApp } from '../../src/main';

export interface TestApp {
  app: INestApplication;
  http: App;
  /** Firma un access token para un usuario de fixture (sin pasar por login). */
  tokenFor(
    userId: string,
    email?: string,
    imp?: { barbershopId: string; by: 'superadmin' | 'support' },
  ): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApp(
  extraControllers: Type[] = [],
  overrides: Array<{ provide: unknown; useValue: unknown }> = [],
): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule], controllers: extraControllers });
  for (const o of overrides) builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: ['error'], rawBody: true });
  configureApp(app, loadEnv());
  await app.init();
  const tokens = app.get(TokenService);
  return {
    app,
    http: app.getHttpServer() as App,
    tokenFor: (userId, email = `${userId}@test.pe`, impersonation) =>
      tokens.signAccess({ userId, email, impersonation }),
    close: () => app.close(),
  };
}
