import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError } from '../errors/app-error';
import { RequestContext } from '../request-context/request-context';
import type { AuthUser } from './auth.types';
import { IS_OPTIONAL_AUTH, IS_PUBLIC, PLATFORM_ROLES } from './decorators';
import { TokenService } from './token.service';
import type { PlatformRole } from '../../generated/prisma/enums';

/**
 * Guard global. Por defecto TODA ruta exige un Bearer token válido,
 * salvo que se marque con @Public() u @OptionalAuth().
 *
 * El rol de plataforma se lee de la BD en cada request (nunca del token), así que
 * quitarle el rol a alguien surte efecto de inmediato.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH, targets);
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req);

    if (isPublic) return true;
    if (!token) {
      if (isOptional) return true;
      throw AppError.unauthenticated('Falta el token de acceso');
    }

    const claims = await this.tokens.verifyAccess(token);
    const user = await this.prisma.run({ kind: 'user', userId: claims.sub }, (tx) =>
      tx.user.findFirst({
        where: { id: claims.sub, deletedAt: null },
        select: { id: true, email: true, platformRole: true },
      }),
    );
    if (!user) throw AppError.unauthenticated();

    const auth: AuthUser = { userId: user.id, email: user.email, platformRole: user.platformRole };
    if (claims.imp) {
      // El token de impersonación solo vale mientras el emisor conserve su rol de plataforma.
      if (user.platformRole !== claims.imp.by) throw AppError.unauthenticated();
      auth.impersonation = { barbershopId: claims.imp.sid, by: claims.imp.by };
    }
    req.auth = auth;
    RequestContext.patch({
      userId: user.id,
      impersonatorUserId: auth.impersonation ? user.id : undefined,
    });

    const roles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
      PLATFORM_ROLES,
      targets,
    );
    if (roles && (!auth.platformRole || !roles.includes(auth.platformRole) || auth.impersonation)) {
      throw AppError.forbidden();
    }
    return true;
  }
}

function extractBearer(req: Request): string | undefined {
  const header = req.header('authorization');
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}
