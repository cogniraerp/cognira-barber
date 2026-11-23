import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { resolveDbSettings, type DbContext } from './db-context';

export type Tx = Prisma.TransactionClient;

/**
 * Único punto de acceso a la BD.
 *
 * Toda consulta de negocio debe pasar por `run(ctx, fn)`: abre una transacción, fija el
 * contexto RLS con set_config(..., is_local = true) —que muere con la transacción, así no se
 * filtra a la siguiente request que reutilice la conexión del pool— y ejecuta `fn`.
 *
 * Consultar con `this.prisma.<modelo>` fuera de `run` no está prohibido por TypeScript, pero
 * la RLS devolverá 0 filas (deny by default), así que un olvido falla de forma segura.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly txTimeoutMs: number;

  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX }),
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
    this.txTimeoutMs = env.DB_TX_TIMEOUT_MS;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado a PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  run<T>(
    ctx: DbContext,
    fn: (tx: Tx) => Promise<T>,
    opts?: { timeoutMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    const s = resolveDbSettings(ctx);
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT
          set_config('app.barbershop_id', ${s.barbershopId}, true),
          set_config('app.user_id', ${s.userId}, true),
          set_config('app.platform_role', ${s.platformRole}, true)`;
        return fn(tx);
      },
      {
        timeout: opts?.timeoutMs ?? this.txTimeoutMs,
        maxWait: 5_000,
        isolationLevel: opts?.isolationLevel,
      },
    );
  }
}
