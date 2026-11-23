import { env } from '@/lib/env';
import { useAuth } from '@/stores/auth';
import { useTenant } from '@/stores/tenant';
import { ApiError, type ProblemDetails } from './errors';

/**
 * Mutator de Orval: TODAS las llamadas a la API pasan por aquí.
 *  - Prefija VITE_API_URL.
 *  - Agrega Authorization y, en /v1/shop/*, X-Tenant-Slug.
 *  - Si el access token venció (o la API responde 401), lo renueva UNA vez con el refresh token
 *    — compartiendo la renovación entre llamadas simultáneas — y reintenta.
 *  - Convierte las respuestas de error (Problem Details) en ApiError.
 */
export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await send(url, init, false);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('json') ? await res.json() : await res.text()) as T;
}

/** Token de impersonación vigente para la barbería de este request (o null). */
function impersonationToken(url: string, slug: string | null): string | null {
  const imp = useAuth.getState().impersonation;
  if (!imp || !slug || imp.slug !== slug || !url.startsWith('/v1/shop')) return null;
  if (imp.expiresAt <= Date.now()) {
    useAuth.getState().setImpersonation(null);
    return null;
  }
  return imp.token;
}

async function send(url: string, init: RequestInit, retried: boolean): Promise<Response> {
  const auth = useAuth.getState();
  const slug = currentTenantSlug();
  const impToken = impersonationToken(url, slug);
  if (!impToken && !retried && auth.refreshToken && auth.expiresAt && auth.expiresAt - Date.now() < 30_000) {
    await refreshSession().catch(() => undefined);
  }
  const headers = new Headers(init.headers);
  const token = impToken ?? useAuth.getState().accessToken;
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  if (slug && url.startsWith('/v1/shop') && !headers.has('x-tenant-slug')) headers.set('x-tenant-slug', slug);

  const res = await fetch(`${env.apiUrl}${url}`, { ...init, headers });
  if (res.ok) return res;

  // Impersonación vencida: se sale de ella (la sesión propia sigue intacta).
  if (res.status === 401 && impToken) useAuth.getState().setImpersonation(null);
  if (res.status === 401 && !impToken && !retried && useAuth.getState().refreshToken && !url.startsWith('/v1/auth/')) {
    const ok = await refreshSession().then(
      () => true,
      () => false,
    );
    if (ok) return send(url, init, true);
    useAuth.getState().clear();
  }
  throw new ApiError(await readProblem(res));
}

/**
 * Barbería del request: la de la URL del panel (/s/:slug/…) y, si no, la del store.
 * Se toma de la URL para que no dependa del orden de render (las queries hijas pueden salir antes
 * de que el layout actualice el store).
 */
export function currentTenantSlug(): string | null {
  const m = /^\/s\/([a-z0-9-]{3,48})(?:\/|$)/.exec(window.location.pathname);
  return m?.[1] ?? useTenant.getState().slug;
}

let refreshing: Promise<void> | null = null;

/** Renueva la sesión. Llamadas concurrentes comparten la misma promesa (el refresh token es de un solo uso). */
export function refreshSession(): Promise<void> {
  refreshing ??= (async () => {
    try {
      const refreshToken = useAuth.getState().refreshToken;
      if (!refreshToken) throw new Error('sin sesión');
      const res = await fetch(`${env.apiUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        useAuth.getState().clear();
        throw new ApiError(await readProblem(res));
      }
      useAuth.getState().setSession(await res.json());
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function readProblem(res: Response): Promise<ProblemDetails> {
  try {
    const body = (await res.json()) as Partial<ProblemDetails>;
    return {
      title: body.title ?? res.statusText,
      status: res.status,
      code: body.code ?? 'INTERNAL',
      ...body,
    } as ProblemDetails;
  } catch {
    return { title: res.statusText || 'Error de red', status: res.status, code: 'INTERNAL' };
  }
}

export type ErrorType<E> = E;
export type BodyType<B> = B;
