import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import type { Request } from 'express';
import { AppError, ErrorCode } from '../errors/app-error';
import type { TenantContext } from './tenant.types';
import { HttpStatus } from '@nestjs/common';

export const TENANT_SCOPED = 'tenancy:scoped';
export const ALLOW_SUSPENDED = 'tenancy:allow-suspended';
export const TENANT_HEADER = 'x-tenant-slug';

/** El controlador/ruta opera sobre una barbería: exige X-Tenant-Slug y membership activa. */
export const TenantScoped = () =>
  applyDecorators(
    SetMetadata(TENANT_SCOPED, true),
    // En Swagger el slug se carga una sola vez en "Authorize" (esquema `tenant`) y se envía en cada request.
    ApiSecurity('tenant'),
  );

/** Permite la ruta aunque la barbería esté suspendida (p. ej. ver/pagar la suscripción). */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED, true);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.tenant) {
      throw new AppError(
        ErrorCode.TENANT_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Ruta sin contexto de barbería',
      );
    }
    return req.tenant;
  },
);
