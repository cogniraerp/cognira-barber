import { Resolver } from 'node:dns/promises';

/** Lo que necesitamos del DNS (inyectable para probar sin red). */
export interface DnsResolver {
  resolveTxt(host: string): Promise<string[][]>;
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
}
export const DNS_RESOLVER = Symbol('DNS_RESOLVER');

/** DNS públicos (no el del servidor, que puede tener caché vieja), con timeout corto. */
export function systemResolver(): DnsResolver {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(['1.1.1.1', '8.8.8.8']);
  return r;
}

/** "No existe ese registro" es una respuesta válida (lista vacía), no un error. */
export async function orEmpty<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (
      code &&
      ['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'NOTFOUND', 'ENOTIMP', 'EREFUSED'].includes(code)
    )
      return [];
    throw e;
  }
}
