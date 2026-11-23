import type { BarbershopStatus, MemberRole, PlatformRole } from '../../generated/prisma/enums';
import type { DbContext } from '../../infra/prisma/db-context';
import type { Permission } from '../rbac/permissions';

/** Barbería actual del request, resuelta por el TenantGuard. */
export interface TenantContext {
  barbershopId: string;
  slug: string;
  name: string;
  status: BarbershopStatus;
  /** manual | billing (solo si está suspendida). */
  suspendedReason?: string | null;
  timezone: string;
  currency: string;
  locale: string;
  userId: string;
  role: MemberRole;
  membershipId: string | null;
  staffId: string | null;
  permissions: ReadonlySet<Permission>;
  /** Rol personalizado del miembro (su nombre se muestra en vez del rol base). */
  customRole?: { id: string; name: string } | null;
  impersonatedBy?: PlatformRole;
}

export function tenantDb(t: TenantContext): DbContext {
  return {
    kind: 'tenant',
    barbershopId: t.barbershopId,
    userId: t.userId,
    impersonatedBy: t.impersonatedBy,
  };
}

export function can(t: TenantContext, perm: Permission): boolean {
  return t.permissions.has(perm);
}
