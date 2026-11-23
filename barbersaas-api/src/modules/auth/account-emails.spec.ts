import { describe, expect, it } from 'vitest';
import { resetEmail, tokenState, verifyEmail } from './account-emails';

const now = new Date('2026-11-21T12:00:00Z');

describe('tokens de un solo uso', () => {
  it('estado según uso y vencimiento', () => {
    expect(tokenState(null, now)).toBe('invalid');
    expect(tokenState({ usedAt: now, expiresAt: new Date('2027-01-01') }, now)).toBe('used');
    expect(tokenState({ usedAt: null, expiresAt: now }, now)).toBe('expired');
    expect(tokenState({ usedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('ok');
  });

  it('los correos llevan el nombre y el enlace', () => {
    const r = resetEmail({ name: 'Ana', url: 'https://x/restablecer?token=abc' });
    expect(r.body).toContain('Hola, Ana:');
    expect(r.body).toContain('https://x/restablecer?token=abc');
    expect(verifyEmail({ name: 'Ana', url: 'https://x/v' }).subject).toMatch(/Confirma/);
  });
});
