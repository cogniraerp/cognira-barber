import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  CashQueryDto,
  CloseShiftDto,
  CreateCashMovementDto,
  CurrentCashDto,
  OpenShiftDto,
  ShiftDetailDto,
  ShiftListDto,
  ShiftsQueryDto,
} from './cash.dto';
import { CashService } from './cash.service';

@ApiTags('shop · caja')
@ApiBearerAuth()
@TenantScoped()
@RequirePermissions('cash.manage')
@Controller('shop/cash')
export class CashController {
  constructor(private readonly svc: CashService) {}

  /** Caja de la sede y su turno abierto (con totales por método y movimientos). */
  @Get('current')
  @ZodResponse({ type: CurrentCashDto })
  current(@CurrentTenant() t: TenantContext, @Query() q: CashQueryDto) {
    return this.svc.current(t, q.locationId);
  }

  @Post('open')
  @ZodResponse({ type: ShiftDetailDto, status: 201 })
  open(@CurrentTenant() t: TenantContext, @Body() dto: OpenShiftDto) {
    return this.svc.open(t, dto);
  }

  /** Ingreso, egreso (p. ej. compra de insumos) o retiro de efectivo. */
  @Post('movements')
  @ZodResponse({ type: ShiftDetailDto, status: 201 })
  addMovement(@CurrentTenant() t: TenantContext, @Body() dto: CreateCashMovementDto) {
    return this.svc.addMovement(t, dto);
  }

  /** Cierre con arqueo: lo contado por método contra lo esperado. */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ShiftDetailDto })
  close(@CurrentTenant() t: TenantContext, @Body() dto: CloseShiftDto) {
    return this.svc.close(t, dto);
  }

  @Get('shifts')
  @ZodResponse({ type: ShiftListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ShiftsQueryDto) {
    return this.svc.list(t, q);
  }

  @Get('shifts/:id')
  @ZodResponse({ type: ShiftDetailDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }
}
