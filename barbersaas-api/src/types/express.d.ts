import type { AuthUser } from '../common/auth/auth.types';
import type { TenantContext } from '../common/tenancy/tenant.types';

declare global {
  namespace Express {
    interface Request {
      /** Usuario autenticado (AuthGuard). */
      auth?: AuthUser;
      /** Barbería del request (TenantGuard), solo en rutas @TenantScoped(). */
      tenant?: TenantContext;
    }
  }
}

export {};
