import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import type { TenantContext } from '../../common/tenancy/tenant.types';
import { ChangePlanResultDto, PlanOptionsDto, ShopChangePlanDto } from './collections.dto';
import { PlanChangeService } from './plan-change.service';

/** Cambio de plan desde Configuración → Suscripción (solo el dueño cambia; billing.manage). */
@ApiTags('shop · suscripción')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/billing')
export class ShopPlanController {
  constructor(private readonly svc: PlanChangeService) {}

  @Get('plans')
  @RequirePermissions('billing.view')
  @ZodResponse({ type: PlanOptionsDto })
  plans(@CurrentTenant() t: TenantContext) {
    return this.svc.options(t);
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing.manage')
  @ZodResponse({ type: ChangePlanResultDto })
  change(@CurrentTenant() t: TenantContext, @Body() dto: ShopChangePlanDto) {
    return this.svc.change(t, dto);
  }

  @Delete('scheduled-change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('billing.manage')
  async cancel(@CurrentTenant() t: TenantContext): Promise<void> {
    await this.svc.cancelScheduled(t);
  }
}
