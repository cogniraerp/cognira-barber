import { describe, expect, it } from 'vitest';
import { PERMISSIONS, resolvePermissions, sanitizeRolePermissions, ungrantable } from './permissions';

describe('resolvePermissions', () => {
  it('owner tiene todo y no se le puede quitar nada', () => {
    const p = resolvePermissions('owner', {}, { 'billing.view': false });
    expect(p.size).toBe(PERMISSIONS.length);
  });

  it('admin no ve facturación por defecto', () => {
    const p = resolvePermissions('admin', {}, {});
    expect(p.has('billing.view')).toBe(false);
    expect(p.has('services.manage')).toBe(true);
  });

  it('la barbería puede ocultar los teléfonos a los barberos', () => {
    const p = resolvePermissions('barber', { barber: { 'customers.view_contact': false } }, {});
    expect(p.has('customers.view_contact')).toBe(false);
    expect(p.has('appointments.view_own')).toBe(true);
  });

  it('el override del miembro gana sobre el de la barbería', () => {
    const p = resolvePermissions(
      'barber',
      { barber: { 'customers.view_contact': false } },
      { 'customers.view_contact': true },
    );
    expect(p.has('customers.view_contact')).toBe(true);
  });

  it('billing.manage nunca se concede a quien no es owner', () => {
    const p = resolvePermissions(
      'admin',
      { admin: { 'billing.manage': true } },
      { 'billing.manage': true },
    );
    expect(p.has('billing.manage')).toBe(false);
  });

  it('ignora JSON inválido o permisos desconocidos', () => {
    expect(() =>
      resolvePermissions('barber', { barber: { 'hack.all': true } }, 'basura'),
    ).not.toThrow();
    const p = resolvePermissions('barber', { barber: { 'hack.all': true } }, 'basura');
    expect([...p].every((x) => (PERMISSIONS as readonly string[]).includes(x))).toBe(true);
  });
});

describe('roles personalizados', () => {
  it('sus permisos reemplazan a los del rol base y del ajuste de la barbería', () => {
    const p = resolvePermissions(
      'receptionist',
      { receptionist: { 'reports.view': true } },
      {},
      { permissions: ['cash.manage', 'customers.view', 'inventado', 'billing.manage'] },
    );
    expect([...p].sort()).toEqual(['cash.manage', 'customers.view']);
  });
  it('el ajuste individual del miembro sigue aplicando encima', () => {
    const p = resolvePermissions('barber', {}, { 'customers.view': false, 'reports.view': true }, { permissions: ['customers.view'] });
    expect([...p]).toEqual(['reports.view']);
  });
  it('sanitizeRolePermissions: sin duplicados, ordenado, sin desconocidos ni exclusivos del owner', () => {
    expect(sanitizeRolePermissions(['reports.view', 'cash.manage', 'reports.view', 'x', 'billing.manage'])).toEqual(['cash.manage', 'reports.view']);
    expect(sanitizeRolePermissions('no-array')).toEqual([]);
  });
});

describe('ungrantable', () => {
  it('el owner puede conceder cualquier cosa', () => {
    expect(
      ungrantable({ role: 'owner', permissions: new Set() }, { 'billing.view': true }),
    ).toEqual([]);
  });
  it('un admin no puede conceder billing.view (no lo tiene), pero sí quitar cosas', () => {
    const admin = { role: 'admin' as const, permissions: resolvePermissions('admin', {}, {}) };
    expect(
      ungrantable(admin, {
        'billing.view': true,
        'customers.export': true,
        'dashboard.view': false,
      }),
    ).toEqual(['billing.view']);
  });
});
