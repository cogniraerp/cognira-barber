import type { PlatformRole } from '../../generated/prisma/enums';

export interface Impersonation {
  barbershopId: string;
  by: PlatformRole;
}

/** Usuario autenticado, adjunto a `req.auth` por el AuthGuard. */
export interface AuthUser {
  userId: string;
  email: string;
  platformRole: PlatformRole | null;
  /** Presente solo en tokens de impersonación emitidos por el panel de plataforma. */
  impersonation?: Impersonation;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  typ: 'access';
  imp?: { sid: string; by: PlatformRole };
}
