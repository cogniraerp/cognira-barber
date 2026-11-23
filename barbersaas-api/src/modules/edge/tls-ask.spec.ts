import { describe, expect, it } from 'vitest';
import { classifyHost } from './tls-ask';

describe('classifyHost (TLS on-demand)', () => {
  const root = 'cognirabarber.pe';
  it('raíz y subdominios de la plataforma', () => {
    expect(classifyHost('cognirabarber.pe', root)).toEqual({ kind: 'platform' });
    expect(classifyHost('API.cognirabarber.pe.', root)).toEqual({ kind: 'platform' });
  });
  it('una barbería por subdominio', () => {
    expect(classifyHost('el-clasico.cognirabarber.pe', root)).toEqual({
      kind: 'shop',
      slug: 'el-clasico',
    });
  });
  it('rechaza otros dominios, niveles extra y nombres inválidos', () => {
    expect(classifyHost('evil.com', root).kind).toBe('reject');
    expect(classifyHost('a.b.cognirabarber.pe', root).kind).toBe('reject');
    expect(classifyHost('x.cognirabarber.pe', root).kind).toBe('reject');
    expect(classifyHost('cognirabarber.pe.evil.com', root).kind).toBe('reject');
  });
});
