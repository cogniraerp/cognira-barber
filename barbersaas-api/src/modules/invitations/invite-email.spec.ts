import { describe, expect, it } from 'vitest';
import { inviteEmail } from './invite-email';

describe('inviteEmail', () => {
  it('lleva la barbería, el rol en español, el enlace y el vencimiento', () => {
    const m = inviteEmail({
      shopName: 'Alvaro Estilistas',
      role: 'owner',
      url: 'https://x/invitacion/t',
      expiresAt: new Date('2026-12-01T03:00:00Z'),
    });
    expect(m.subject).toBe('Te invitaron a Alvaro Estilistas en Cognira Barber');
    expect(m.body).toContain('como Dueño');
    expect(m.body).toContain('https://x/invitacion/t');
    expect(m.body).toContain('30 de noviembre de 2026');
  });
});
