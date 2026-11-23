import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const REQUIRED_PERMISSIONS = 'rbac:required';

/** Exige TODOS los permisos indicados. Solo tiene efecto en controladores con @TenantScoped(). */
export const RequirePermissions = (...perms: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, perms);
