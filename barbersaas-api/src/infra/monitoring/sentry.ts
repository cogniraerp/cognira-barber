import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Env } from '../../config/env';

/**
 * Monitoreo de errores con Sentry (opcional: sin SENTRY_DSN no hace nada). Solo errores, sin
 * trazas de rendimiento ni datos personales por defecto.
 */
export function initSentry(env: Env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    serverName: env.APP_MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  return true;
}

/**
 * Logger de Nest que, además de escribir en consola, manda cada `error` a Sentry. Así llegan los
 * 5xx (los registra el filtro de errores) y las fallas de los jobs del worker, sin tocar cada módulo.
 */
export class SentryLogger extends ConsoleLogger {
  constructor(
    levels: LogLevel[],
    private readonly enabled: boolean,
  ) {
    super({ logLevels: levels });
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...(rest as [string?, string?]));
    if (!this.enabled) return;
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const err = message instanceof Error ? message : new Error(String(message));
    Sentry.captureException(err, { tags: context ? { context } : undefined });
  }
}
