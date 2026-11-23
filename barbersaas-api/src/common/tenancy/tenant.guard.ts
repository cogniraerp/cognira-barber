import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppError, ErrorCode } from '../errors/app-error';
import { resolvePermissions, type Permission } from '../rbac/permissions';
import { REQUIRED_PERMISSIONS } from '../rbac/require-permissions';
import { ALLOW_SUSPENDED, TENANT_HEADER, TENANT_SCOPED } from './decorators';
import type { TenantContext } from './tenant.types';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

/**
 * Guard global (corre después del AuthGuard). En rutas @TenantScoped():
 *  1. Resuelve la barbería a partir de X-Tenant-Slug.
 *  2. Verifica que el usuario es miembro activo (o un token de impersonación de esa barbería).
 *  3. Calcula los permisos efectivos y aplica @RequirePermissions().
 *
 * La resolución usa el contexto 'system' (aún no sabemos a qué tenant pertenece el request);
 * todo lo que venga después corre con el contexto del tenant y la RLS lo acota.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (!this.reflector.getAllAndOverride<boolean>(TENANT_SCOPED, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth) throw AppError.unauthenticated();

    const slug = req.header(TENANT_HEADER)?.trim().toLowerCase();
    if (!slug) {
      throw new AppError(
        ErrorCode.TENANT_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Falta el header X-Tenant-Slug',
      );
    }
    if (!SLUG_RE.test(slug)) throw tenantNotFound();

    const found = await this.prisma.run({ kind: 'system' }, async (tx) => {
      const shop = await tx.barbershop.findFirst({
        where: { slug, deletedAt: null, status: { not: 'deleted' } },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          suspendedReason: true,
          timezone: true,
          currency: true,
          locale: true,
          settings: { select: { permissions: true } },
        },
      });
      if (!shop) return null;
      const membership = auth.impersonation
        ? null
        : await tx.membership.findFirst({
            where: {
              barbershopId: shop.id,
              userId: auth.userId,
              status: 'active',
              deletedAt: null,
            },
            select: {
              id: true,
              role: true,
              permissions: true,
              staff: { select: { id: true } },
              customRole: { select: { id: true, name: true, permissions: true, deletedAt: true } },
            },
          });
      return { shop, membership };
    });
    if (!found) throw tenantNotFound();
    const { shop, membership } = found;

    let tenant: TenantContext;
    const base = {
      barbershopId: shop.id,
      slug: shop.slug,
      name: shop.name,
      status: shop.status,
      suspendedReason: shop.suspendedReason,
      timezone: shop.timezone,
      currency: shop.currency,
      locale: shop.locale,
      userId: auth.userId,
    };
    if (auth.impersonation) {
      if (auth.impersonation.barbershopId !== shop.id)
        throw AppError.forbidden('Token de impersonación de otra barbería');
      const permissions = resolvePermissions('owner', {}, {});
      // Soporte impersona sin acceso a facturación (la RLS también lo bloquea).
      if (auth.impersonation.by === 'support') {
        permissions.delete('billing.view');
        permissions.delete('billing.manage');
      }
      tenant = {
        ...base,
        role: 'owner',
        membershipId: null,
        staffId: null,
        permissions,
        impersonatedBy: auth.impersonation.by,
      };
    } else {
      if (!membership) throw AppError.forbidden('No perteneces a esta barbería');
      // Un rol personalizado eliminado deja al miembro con los permisos de su rol base.
      const customRole = membership.customRole && !membership.customRole.deletedAt ? membership.customRole : null;
      tenant = {
        ...base,
        role: membership.role,
        membershipId: membership.id,
        staffId: membership.staff?.id ?? null,
        customRole: customRole ? { id: customRole.id, name: customRole.name } : null,
        permissions: resolvePermissions(
          membership.role,
          shop.settings?.permissions,
          membership.permissions,
          customRole,
        ),
      };
    }

    if (
      tenant.status === 'suspended' &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED, targets)
    ) {
      throw new AppError(
        ErrorCode.TENANT_SUSPENDED,
        HttpStatus.FORBIDDEN,
        'La barbería está suspendida',
      );
    }

    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets) ??
      [];
    const missing = required.filter((p) => !tenant.permissions.has(p));
    if (missing.length) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'No tienes permiso para esta acción',
        { missing },
      );
    }

    req.tenant = tenant;
    return true;
  }
}

function tenantNotFound(): AppError {
  return new AppError(ErrorCode.TENANT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Barbería no encontrada');
}
