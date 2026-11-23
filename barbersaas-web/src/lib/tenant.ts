/**
 * De dónde sale la barbería según la URL:
 *  - {slug}.ROOT_DOMAIN           → página pública de esa barbería (sin login)
 *  - app.ROOT_DOMAIN / ROOT_DOMAIN / localhost → la app (login, /s/:slug panel, /platform, /b/:slug)
 * El panel usa SIEMPRE el slug de la ruta (/s/:slug): así hay un solo origen y una sola sesión
 * aunque el usuario gestione varias barberías.
 */
const APP_HOSTS = new Set(['app', 'www', 'admin']);

export type HostKind = { kind: 'app' } | { kind: 'shop-public'; slug: string };

export function resolveHost(hostname: string, rootDomain: string): HostKind {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const root = rootDomain.toLowerCase();
  if (host === root || host === 'localhost' || host === '127.0.0.1') return { kind: 'app' };
  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (!sub.includes('.') && !APP_HOSTS.has(sub) && /^[a-z0-9-]{3,48}$/.test(sub))
      return { kind: 'shop-public', slug: sub };
  }
  return { kind: 'app' };
}

/** URL pública de reservas de una barbería (subdominio). */
export function publicShopUrl(
  slug: string,
  rootDomain: string,
  protocol = window.location.protocol,
  port = window.location.port,
): string {
  return `${protocol}//${slug}.${rootDomain}${port ? `:${port}` : ''}/`;
}

/**
 * ¿Puede ser el dominio propio de una barbería? (no es nuestro dominio, ni localhost, ni una IP).
 * En producción Caddy solo deja llegar dominios verificados.
 */
export function isCustomDomainCandidate(hostname: string, rootDomain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const root = rootDomain.toLowerCase();
  if (!host.includes('.') || host === root || host.endsWith(`.${root}`)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return false;
  return true;
}

let resolved: HostKind | null = null;

/** Host actual ya resuelto (incluye el dominio propio, si se resolvió al arrancar). */
export function currentHost(rootDomain: string, hostname = window.location.hostname): HostKind {
  return resolved ?? resolveHost(hostname, rootDomain);
}

/**
 * Al arrancar la web: si se abrió en un dominio propio, pregunta a la API de qué barbería es.
 * Si no lo conoce, se queda como la app.
 */
export async function bootstrapHost(rootDomain: string, apiUrl: string, hostname = window.location.hostname): Promise<HostKind> {
  resolved = resolveHost(hostname, rootDomain);
  if (resolved.kind === 'app' && isCustomDomainCandidate(hostname, rootDomain)) {
    try {
      const r = await fetch(`${apiUrl}/v1/public/resolve-domain?host=${encodeURIComponent(hostname)}`);
      if (r.ok) {
        const { slug } = (await r.json()) as { slug: string };
        resolved = { kind: 'shop-public', slug };
      }
    } catch {
      /* sin red: se queda como la app */
    }
  }
  return resolved;
}

/** Enlace a la página pública de la barbería: subdominio o /b/{slug}, según la configuración. */
export function shopPageUrl(
  slug: string,
  opts: { rootDomain: string; subdomains: boolean; origin?: string },
): string {
  if (opts.subdomains) return publicShopUrl(slug, opts.rootDomain);
  return `${(opts.origin ?? window.location.origin).replace(/\/$/, '')}/b/${slug}`;
}
