import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';

/** Usuario autenticado si lo hay (rutas @OptionalAuth); undefined si es anónimo. */
export const CurrentUserOptional = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request>().auth,
);
