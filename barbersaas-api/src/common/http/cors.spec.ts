import { describe, expect, it } from 'vitest';
import { buildCorsOptions, buildOriginMatcher } from './cors';

describe('CORS origin matcher', () => {
  const allowed = buildOriginMatcher('barbersaas.com', ['http://localhost:5173']);

  it.each([
    'https://barbersaas.com',
    'https://elbarbas.barbersaas.com',
    'https://admin.barbersaas.com',
    'http://localhost:5173',
  ])('permite %s', (o) => expect(allowed(o)).toBe(true));

  it.each([
    'https://barbersaas.com.evil.io',
    'https://evilbarbersaas.com',
    'https://elbarbas.barbersaas.co',
    'http://localhost:3000',
    'null',
  ])('rechaza %s', (o) => expect(allowed(o)).toBe(false));
});

describe('CORS con dominios propios', () => {
  const ask = (opts: ReturnType<typeof buildCorsOptions>, origin: string) =>
    new Promise<boolean>((resolve) => {
      const fn = opts.origin as (o: string, cb: (e: Error | null, ok?: boolean) => void) => void;
      fn(origin, (_e, ok) => resolve(!!ok));
    });

  it('acepta solo dominios propios verificados y por https', async () => {
    const opts = buildCorsOptions('cognirabarber.pe', [], (h) =>
      Promise.resolve(h === 'reservas.elbarbas.pe'),
    );
    expect(await ask(opts, 'https://reservas.elbarbas.pe')).toBe(true);
    expect(await ask(opts, 'http://reservas.elbarbas.pe')).toBe(false);
    expect(await ask(opts, 'https://evil.example.com')).toBe(false);
    expect(await ask(opts, 'https://app.cognirabarber.pe')).toBe(true);
  });

  it('si la consulta falla, no permite', async () => {
    const opts = buildCorsOptions('cognirabarber.pe', [], () =>
      Promise.reject(new Error('bd caída')),
    );
    expect(await ask(opts, 'https://reservas.elbarbas.pe')).toBe(false);
  });
});
