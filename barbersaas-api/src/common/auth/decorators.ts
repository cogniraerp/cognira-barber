import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PlatformRole } from '../../generated/prisma/enums';
import { AppError } from '../errors/app-error';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const IS_OPTIONAL_AUTH = 'auth:optional';
export const PLATFORM_ROLES = 'auth:platform-roles';

/** Ruta sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Autenticación opcional: si llega un token válido se adjunta `req.auth`; si no, sigue anónimo. */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH, true);
/** Solo usuarios con alguno de estos roles de plataforma. */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
});
