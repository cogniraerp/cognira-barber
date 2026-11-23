import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapHost, currentHost, isCustomDomainCandidate, resolveHost, shopPageUrl } from './tenant';

const R = 'barbersaas.com';
describe('resolveHost', () => {
  it.each([
    'barbersaas.com',
    'app.barbersaas.com',
    'www.barbersaas.com',
    'admin.barbersaas.com',
    'localhost',
    'otro.com',
  ])('%s → app', (h) => expect(resolveHost(h, R)).toEqual({ kind: 'app' }));
  it('subdominio de barbería → página pública', () => {
    expect(resolveHost('el-clasico.barbersaas.com', R)).toEqual({ kind: 'shop-public', slug: 'el-clasico' });
    expect(resolveHost('EL-CLASICO.barbersaas.com.', R)).toEqual({ kind: 'shop-public', slug: 'el-clasico' });
  });
  it('ignora sub-subdominios y slugs inválidos', () => {
    expect(resolveHost('a.b.barbersaas.com', R)).toEqual({ kind: 'app' });
    expect(resolveHost('x.barbersaas.com', R)).toEqual({ kind: 'app' });
  });
  it('dev con *.localhost', () =>
    expect(resolveHost('studio-fade.barbersaas.localhost', 'barbersaas.localhost')).toEqual({
      kind: 'shop-public',
      slug: 'studio-fade',
    }));
});

describe('dominio propio', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('detecta candidatos (no nuestro dominio, ni localhost, ni IP)', () => {
    expect(isCustomDomainCandidate('reservas.elbarbas.pe', 'cognirabarber.pe')).toBe(true);
    expect(isCustomDomainCandidate('app.cognirabarber.pe', 'cognirabarber.pe')).toBe(false);
    expect(isCustomDomainCandidate('cognirabarber.pe', 'cognirabarber.pe')).toBe(false);
    expect(isCustomDomainCandidate('localhost', 'cognirabarber.pe')).toBe(false);
    expect(isCustomDomainCandidate('x.barbersaas.localhost', 'cognirabarber.pe')).toBe(false);
    expect(isCustomDomainCandidate('192.168.1.10', 'cognirabarber.pe')).toBe(false);
  });

  it('al arrancar en un dominio propio, la API dice de qué barbería es', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ slug: 'el-barbas' })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await bootstrapHost('cognirabarber.pe', 'https://api.x', 'reservas.elbarbas.pe')).toEqual({ kind: 'shop-public', slug: 'el-barbas' });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.x/v1/public/resolve-domain?host=reservas.elbarbas.pe');
    expect(currentHost('cognirabarber.pe', 'otro')).toEqual({ kind: 'shop-public', slug: 'el-barbas' });
  });

  it('si la API no lo conoce (o no hay red), sigue como la app; nuestro dominio no consulta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    expect(await bootstrapHost('cognirabarber.pe', 'https://api.x', 'desconocido.com')).toEqual({ kind: 'app' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await bootstrapHost('cognirabarber.pe', 'https://api.x', 'desconocido.com')).toEqual({ kind: 'app' });
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await bootstrapHost('cognirabarber.pe', 'https://api.x', 'el-clasico.cognirabarber.pe')).toEqual({ kind: 'shop-public', slug: 'el-clasico' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('shopPageUrl', () => {
  it('subdominio o /b/{slug} según la configuración', () => {
    expect(shopPageUrl('el-clasico', { rootDomain: 'barber.codecraft.net.pe', subdomains: false, origin: 'https://app.barber.codecraft.net.pe/' })).toBe(
      'https://app.barber.codecraft.net.pe/b/el-clasico',
    );
    expect(shopPageUrl('el-clasico', { rootDomain: 'barber.codecraft.net.pe', subdomains: true })).toMatch(/\/\/el-clasico\.barber\.codecraft\.net\.pe/);
  });
});
