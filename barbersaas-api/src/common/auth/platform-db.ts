import type { DbContext } from '../../infra/prisma/db-context';
import { AppError } from '../errors/app-error';
import type { AuthUser } from './auth.types';

/** Contexto de BD para el panel de plataforma según el rol del usuario. */
export function platformDb(u: AuthUser): DbContext {
  if (u.platformRole === 'superadmin') return { kind: 'superadmin', userId: u.userId };
  if (u.platformRole === 'support') return { kind: 'support', userId: u.userId };
  throw AppError.forbidden();
}
