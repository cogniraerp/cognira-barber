import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  CommissionConfigDto,
  CommissionConfigOutDto,
  CommissionSummaryDto,
  CreatePayoutDto,
  EntriesQueryDto,
  EntryListDto,
  MyCommissionsDto,
  PayoutDto,
  PayoutListDto,
  PayoutsQueryDto,
  PeriodQueryDto,
} from './commissions.dto';
import { CommissionsService } from './commissions.service';

@ApiTags('shop · comisiones')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/commissions')
export class CommissionsController {
  constructor(private readonly svc: CommissionsService) {}

  /** Lo del propio barbero (Mi día → Mis comisiones). */
  @Get('me')
  @RequirePermissions('commissions.view_own')
  @ZodResponse({ type: MyCommissionsDto })
  me(@CurrentTenant() t: TenantContext, @Query() q: PeriodQueryDto) {
    return this.svc.me(t, q.from, q.to);
  }

  @Get('summary')
  @RequirePermissions('commissions.manage')
  @ZodResponse({ type: CommissionSummaryDto })
  summary(@CurrentTenant() t: TenantContext, @Query() q: PeriodQueryDto) {
    return this.svc.summary(t, q.from, q.to);
  }

  @Get('entries')
  @RequirePermissions('commissions.manage')
  @ZodResponse({ type: EntryListDto })
  entries(@CurrentTenant() t: TenantContext, @Query() q: EntriesQueryDto) {
    return this.svc.entries(t, q);
  }

  @Get('payouts')
  @RequirePermissions('commissions.manage')
  @ZodResponse({ type: PayoutListDto })
  payouts(@CurrentTenant() t: TenantContext, @Query() q: PayoutsQueryDto) {
    return this.svc.payouts(t, q);
  }

  /** Liquidar: paga todo lo pendiente del barbero hasta la fecha indicada. */
  @Post('payouts')
  @RequirePermissions('commissions.manage')
  @ZodResponse({ type: PayoutDto, status: 201 })
  createPayout(@CurrentTenant() t: TenantContext, @Body() dto: CreatePayoutDto) {
    return this.svc.createPayout(t, dto);
  }

  @Get('config/:staffId')
  @RequirePermissions('commissions.manage')
  @ZodResponse({ type: CommissionConfigOutDto })
  getConfig(@CurrentTenant() t: TenantContext, @Param('staffId', UuidPipe) staffId: string) {
    return this.svc.getConfig(t, staffId);
  }

  @Put('config/:staffId')
  @RequirePermissions('commissions.manage')
  @ZodResponse({ type: CommissionConfigOutDto })
  setConfig(
    @CurrentTenant() t: TenantContext,
    @Param('staffId', UuidPipe) staffId: string,
    @Body() dto: CommissionConfigDto,
  ) {
    return this.svc.setConfig(t, staffId, dto);
  }
}
