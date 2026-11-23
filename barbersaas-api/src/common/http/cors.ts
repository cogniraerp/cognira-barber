import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** ¿Este hostname es el dominio propio verificado de alguna barbería? */
export type CustomDomainCheck = (host: string) => Promise<boolean>;

/**
 * Permite: el dominio raíz, cualquier subdominio de barbería (*.ROOT_DOMAIN), los orígenes extra y
 * los dominios propios verificados de las barberías (consultados a la BD, con caché).
 */
export function buildCorsOptions(
  rootDomain: string,
  extraOrigins: string[],
  isCustomDomain?: CustomDomainCheck,
): CorsOptions {
  const allowed = buildOriginMatcher(rootDomain, extraOrigins);
  return {
    origin: (origin, cb) => {
      if (!origin || allowed(origin)) return cb(null, true);
      const host = /^https:\/\/([a-z0-9.-]+)(:\d+)?$/i.exec(origin)?.[1];
      if (!host || !isCustomDomain) return cb(null, false);
      isCustomDomain(host).then(
        (ok) => cb(null, ok),
        () => cb(null, false),
      );
    },
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Tenant-Slug',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
}

export function buildOriginMatcher(rootDomain: string, extraOrigins: string[]) {
  const escaped = rootDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^https?://([a-z0-9-]+\\.)*${escaped}(:\\d+)?$`, 'i');
  const extras = new Set(extraOrigins);
  return (origin: string): boolean => extras.has(origin) || pattern.test(origin);
}
