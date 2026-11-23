import { describe, expect, it } from 'vitest';
import { resolveDbSettings } from './db-context';

describe('resolveDbSettings', () => {
  it('tenant normal: sin rol de plataforma', () => {
    expect(resolveDbSettings({ kind: 'tenant', barbershopId: 's1', userId: 'u1' })).toEqual({
      barbershopId: 's1',
      userId: 'u1',
      platformRole: '',
    });
  });

  it('soporte impersonando mantiene platform_role=support (para que RLS le oculte la facturación)', () => {
    expect(
      resolveDbSettings({
        kind: 'tenant',
        barbershopId: 's1',
        userId: 'u1',
        impersonatedBy: 'support',
      }),
    ).toEqual({ barbershopId: 's1', userId: 'u1', platformRole: 'support' });
  });

  it('superadmin impersonando se comporta como el tenant (sin privilegios globales)', () => {
    expect(
      resolveDbSettings({
        kind: 'tenant',
        barbershopId: 's1',
        userId: 'u1',
        impersonatedBy: 'superadmin',
      }).platformRole,
    ).toBe('');
  });

  it('user / superadmin / system', () => {
    expect(resolveDbSettings({ kind: 'user', userId: 'u1' })).toEqual({
      barbershopId: '',
      userId: 'u1',
      platformRole: '',
    });
    expect(resolveDbSettings({ kind: 'superadmin', userId: 'u1' }).platformRole).toBe('superadmin');
    expect(resolveDbSettings({ kind: 'system' })).toEqual({
      barbershopId: '',
      userId: '',
      platformRole: 'system',
    });
  });
});
