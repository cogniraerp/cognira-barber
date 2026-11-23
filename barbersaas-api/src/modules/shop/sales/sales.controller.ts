import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  CreateSaleDto,
  ListSalesQueryDto,
  SaleDto,
  SaleListWithSummaryDto,
  VoidSaleDto,
} from './sales.dto';
import { SalesService } from './sales.service';

@ApiTags('shop · ventas')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/sales')
export class SalesController {
  constructor(private readonly svc: SalesService) {}

  /** Cobrar: servicios y/o productos, descuento, propina y pago mixto. Requiere caja abierta. */
  @Post()
  @RequirePermissions('sales.create')
  @ZodResponse({ type: SaleDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateSaleDto) {
    return this.svc.create(t, dto);
  }

  /** Con `sales.view_all` todas; si no, las que registró o donde atendió. Incluye el resumen del filtro. */
  @Get()
  @RequirePermissions('sales.create')
  @ZodResponse({ type: SaleListWithSummaryDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ListSalesQueryDto) {
    return this.svc.list(t, q);
  }

  @Get(':id')
  @RequirePermissions('sales.create')
  @ZodResponse({ type: SaleDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  @Post(':id/void')
  @RequirePermissions('sales.void')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: SaleDto })
  void(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: VoidSaleDto,
  ) {
    return this.svc.void(t, id, dto);
  }
}
