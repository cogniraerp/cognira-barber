import { z } from 'zod';
import type { MemberRole } from '../../generated/prisma/enums';

/** Catálogo de permisos. Añadir aquí; no renombrar (se guardan en overrides JSON). */
export const PERMISSIONS = [
  'dashboard.view',
  'shop.manage',
  'billing.view',
  'billing.manage',
  'members.manage',
  'locations.manage',
  'schedules.manage',
  'services.manage',
  'staff.manage',
  'customers.view',
  'customers.manage',
  'customers.view_contact',
  'customers.export',
  'appointments.view_all',
  'appointments.manage_all',
  'appointments.view_own',
  'appointments.manage_own',
  'whatsapp.manage',
  'reports.view',
  'cash.manage',
  'commissions.view_own',
  // Fase 2
  'products.manage',
  'inventory.manage',
  'sales.create',
  'sales.void',
  'sales.view_all',
  'commissions.manage',
  'payments.manage',
  // Libro de Reclamaciones de la barbería
  'complaints.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const PermissionSchema = z.enum(PERMISSIONS);

/** Overrides parciales: { "customers.view_contact": false } */
export const PermissionOverridesSchema = z.partialRecord(PermissionSchema, z.boolean());
export type PermissionOverrides = z.infer<typeof PermissionOverridesSchema>;

/** Overrides por rol a nivel barbería (barbershop_settings.permissions). El owner no es configurable. */
export const ShopPermissionOverridesSchema = z.partialRecord(
  z.enum(['admin', 'receptionist', 'barber']),
  PermissionOverridesSchema,
);
export type ShopPermissionOverrides = z.infer<typeof ShopPermissionOverridesSchema>;

const ALL = new Set<Permission>(PERMISSIONS);
const NOT_BILLING = PERMISSIONS.filter((p) => !p.startsWith('billing.'));

export const DEFAULT_ROLE_PERMISSIONS: Record<MemberRole, ReadonlySet<Permission>> = {
  owner: ALL,
  admin: new Set(NOT_BILLING),
  receptionist: new Set<Permission>([
    'dashboard.view',
    'customers.view',
    'customers.manage',
    'customers.view_contact',
    'appointments.view_all',
    'appointments.manage_all',
    'appointments.view_own',
    'appointments.manage_own',
    'cash.manage',
    'inventory.manage',
    'sales.create',
    'sales.view_all',
  ]),
  barber: new Set<Permission>([
    'dashboard.view',
    'customers.view',
    'customers.view_contact',
    'appointments.view_own',
    'appointments.manage_own',
    'commissions.view_own',
  ]),
};

/** Permisos que nunca se conceden por override a quien no sea owner. */
const OWNER_ONLY: ReadonlySet<Permission> = new Set(['billing.manage']);

/** Lista de permisos de un rol personalizado: se descartan los desconocidos y los exclusivos del owner. */
export function sanitizeRolePermissions(list: unknown): Permission[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p): p is Permission => ALL.has(p as Permission) && !OWNER_ONLY.has(p as Permission)))].sort();
}

/**
 * Permisos efectivos:
 *  - rol del sistema: defaults del rol ⊕ overrides de la barbería para ese rol ⊕ overrides del miembro;
 *  - rol personalizado: SUS permisos (reemplazan a los del rol base) ⊕ overrides del miembro.
 * Los valores inválidos en el JSON se ignoran (nunca rompen el login de la barbería).
 */
export function resolvePermissions(
  role: MemberRole,
  shopOverrides: unknown,
  memberOverrides: unknown,
  customRole?: { permissions: unknown } | null,
): Set<Permission> {
  if (role === 'owner') return new Set(ALL);
  const member = PermissionOverridesSchema.safeParse(memberOverrides);
  let result: Set<Permission>;
  let shopLayer: PermissionOverrides | undefined;
  if (customRole) {
    result = new Set(sanitizeRolePermissions(customRole.permissions));
  } else {
    result = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
    const shop = ShopPermissionOverridesSchema.safeParse(shopOverrides);
    shopLayer = shop.success ? shop.data[role] : undefined;
  }
  const layers = [shopLayer, member.success ? member.data : undefined];
  for (const layer of layers) {
    for (const [perm, allowed] of Object.entries(layer ?? {}) as Array<[Permission, boolean]>) {
      if (allowed && !OWNER_ONLY.has(perm)) result.add(perm);
      else result.delete(perm);
    }
  }
  return result;
}

/**
 * Evita escalada de privilegios: quien no es owner solo puede CONCEDER permisos que él mismo tiene.
 * (Quitar siempre se permite.) Devuelve los permisos que no puede conceder.
 */
export function ungrantable(
  actor: { role: MemberRole; permissions: ReadonlySet<Permission> },
  overrides: PermissionOverrides,
): Permission[] {
  if (actor.role === 'owner') return [];
  return (Object.entries(overrides) as Array<[Permission, boolean]>)
    .filter(([perm, allowed]) => allowed && !actor.permissions.has(perm))
    .map(([perm]) => perm);
}
