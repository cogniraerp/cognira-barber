/** Subdominios de la plataforma (no son barberías): siempre tienen certificado. */
export const PLATFORM_HOSTS = new Set(['app', 'www', 'api', 'admin']);

export type AskResult = { kind: 'platform' } | { kind: 'shop'; slug: string } | { kind: 'reject' };

/**
 * ¿A qué corresponde un hostname? Lo usa Caddy (TLS on-demand) antes de emitir un certificado:
 * la raíz y app/api/www son de la plataforma; {slug}.raíz es una barbería (se valida en la BD).
 */
export function classifyHost(domain: string, rootDomain: string): AskResult {
  const host = domain.trim().toLowerCase().replace(/\.$/, '');
  const root = rootDomain.toLowerCase();
  if (!host || host.length > 253) return { kind: 'reject' };
  if (host === root) return { kind: 'platform' };
  if (!host.endsWith(`.${root}`)) return { kind: 'reject' };
  const sub = host.slice(0, -(root.length + 1));
  if (PLATFORM_HOSTS.has(sub)) return { kind: 'platform' };
  if (!/^[a-z0-9-]{3,48}$/.test(sub)) return { kind: 'reject' };
  return { kind: 'shop', slug: sub };
}
