import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/stores/auth';
import { useTenant } from '@/stores/tenant';
import { ApiError } from './errors';
import { apiFetch } from './http';

const user = { id: 'u1', email: 'a@b.pe', fullName: 'A', platformRole: null };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  beforeEach(() => {
    useAuth.getState().setSession({ accessToken: 'old', refreshToken: 'r1', expiresIn: 900, user });
    useTenant.getState().setSlug('el-clasico');
  });
  afterEach(() => vi.restoreAllMocks());

  it('agrega token y X-Tenant-Slug solo en /v1/shop', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, { ok: true }));
    await apiFetch('/v1/shop/context');
    await apiFetch('/v1/me');
    const h1 = new Headers(f.mock.calls[0]![1]!.headers);
    const h2 = new Headers(f.mock.calls[1]![1]!.headers);
    expect(h1.get('authorization')).toBe('Bearer old');
    expect(h1.get('x-tenant-slug')).toBe('el-clasico');
    expect(h2.get('x-tenant-slug')).toBeNull();
  });

  it('ante 401 renueva una sola vez para llamadas simultáneas y reintenta', async () => {
    let refreshes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/refresh')) {
        refreshes++;
        return json(200, {
          accessToken: 'new',
          refreshToken: 'r2',
          expiresIn: 900,
          tokenType: 'Bearer',
          user,
        });
      }
      const auth = new Headers(init?.headers).get('authorization');
      return auth === 'Bearer new'
        ? json(200, { url })
        : json(401, { title: 'Token expirado', status: 401, code: 'UNAUTHENTICATED' });
    });
    const [a, b] = await Promise.all([
      apiFetch<{ url: string }>('/v1/me'),
      apiFetch<{ url: string }>('/v1/me/barbershops'),
    ]);
    expect(a.url).toContain('/v1/me');
    expect(b.url).toContain('/v1/me/barbershops');
    expect(refreshes).toBe(1);
    expect(useAuth.getState().refreshToken).toBe('r2');
  });

  it('si el refresh falla, cierra la sesión y propaga el error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json(401, { title: 'Sesión inválida', status: 401, code: 'UNAUTHENTICATED' }),
    );
    await expect(apiFetch('/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(useAuth.getState().accessToken).toBeNull();
  });

  it('impersonación: usa su token solo en /v1/shop de ESA barbería, sin tocar la sesión propia', async () => {
    useAuth.getState().setImpersonation({ token: 'imp', barbershopId: 'b1', slug: 'el-clasico', name: 'El Clásico', expiresAt: Date.now() + 60_000 });
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, {}));
    await apiFetch('/v1/shop/context');
    await apiFetch('/v1/platform/barbershops');
    useTenant.getState().setSlug('studio-fade');
    await apiFetch('/v1/shop/context');
    const auth = (i: number) => new Headers(f.mock.calls[i]![1]!.headers).get('authorization');
    expect([auth(0), auth(1), auth(2)]).toEqual(['Bearer imp', 'Bearer old', 'Bearer old']);
    useAuth.getState().setImpersonation(null);
  });

  it('impersonación vencida (401): se descarta sin cerrar la sesión propia', async () => {
    useAuth.getState().setImpersonation({ token: 'imp', barbershopId: 'b1', slug: 'el-clasico', name: 'El Clásico', expiresAt: Date.now() + 60_000 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(401, { title: 'Token expirado', status: 401, code: 'UNAUTHENTICATED' }));
    await expect(apiFetch('/v1/shop/context')).rejects.toBeInstanceOf(ApiError);
    expect(useAuth.getState().impersonation).toBeNull();
    expect(useAuth.getState().accessToken).toBe('old');
  });

  it('convierte Problem Details en ApiError con errores por campo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(400, {
        title: 'Datos inválidos',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'email', message: 'Email inválido' }],
      }),
    );
    const e = await apiFetch('/v1/auth/register', { method: 'POST' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('VALIDATION_FAILED');
    expect((e as ApiError).fieldErrors()).toEqual({ email: 'Email inválido' });
  });
});
