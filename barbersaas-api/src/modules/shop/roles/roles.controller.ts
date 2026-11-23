import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  CreateShopRoleDto,
  DeletedRoleDto,
  ShopRoleDto,
  ShopRoleListDto,
  UpdateShopRoleDto,
} from './roles.dto';
import { RolesService } from './roles.service';

/** Roles personalizados ("Cajero", "Encargado de sede"…). Los 4 del sistema siguen en settings/permissions. */
@ApiTags('shop · equipo')
@ApiBearerAuth()
@TenantScoped()
@RequirePermissions('members.manage')
@Controller('shop/roles')
export class RolesController {
  constructor(private readonly svc: RolesService) {}

  @Get()
  @ZodResponse({ type: ShopRoleListDto })
  list(@CurrentTenant() t: TenantContext) {
    return this.svc.list(t);
  }

  @Post()
  @ZodResponse({ type: ShopRoleDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateShopRoleDto) {
    return this.svc.create(t, dto);
  }

  @Patch(':id')
  @ZodResponse({ type: ShopRoleDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateShopRoleDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Delete(':id')
  @ZodResponse({ type: DeletedRoleDto })
  remove(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.remove(t, id);
  }
}
