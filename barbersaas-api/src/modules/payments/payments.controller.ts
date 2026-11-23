import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import type { TenantContext } from '../../common/tenancy/tenant.types';
import { GatewayAccountsService } from './accounts.service';
import { ChargesService } from './charges.service';
import { RefundsService } from './refunds.service';
import {
  ChargeDto,
  ChargeListDto,
  ChargesQueryDto,
  ConnectGatewayDto,
  CreateChargeDto,
  GatewayAccountDto,
  GatewayOverviewDto,
  RefundDto,
  RefundListDto,
  RefundsQueryDto,
  UpdateGatewayDto,
} from './payments.dto';

@ApiTags('shop · pagos en línea')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/payment-gateways')
export class GatewayAccountsController {
  constructor(private readonly svc: GatewayAccountsService) {}

  @Get()
  @RequirePermissions('payments.manage')
  @ZodResponse({ type: GatewayOverviewDto })
  overview(@CurrentTenant() t: TenantContext) {
    return this.svc.overview(t);
  }

  /** Conecta una pasarela: prueba las credenciales y las guarda cifradas. */
  @Post()
  @RequirePermissions('payments.manage')
  @ZodResponse({ status: 201, type: GatewayAccountDto })
  connect(@CurrentTenant() t: TenantContext, @Body() dto: ConnectGatewayDto) {
    return this.svc.connect(t, dto);
  }

  /** Cambiar credenciales (se vuelven a probar) o activar/desactivar (solo una activa). */
  @Patch(':id')
  @RequirePermissions('payments.manage')
  @ZodResponse({ type: GatewayAccountDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateGatewayDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ZodResponse({ type: GatewayAccountDto })
  verify(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.verify(t, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('payments.manage')
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(t, id);
  }
}

@ApiTags('shop · pagos en línea')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/payment-charges')
export class ChargesController {
  constructor(private readonly svc: ChargesService) {}

  /** Genera un link/QR de pago por el monto indicado (vence en 30 min). */
  @Post()
  @RequirePermissions('sales.create')
  @ZodResponse({ status: 201, type: ChargeDto })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateChargeDto) {
    return this.svc.create(t, dto);
  }

  @Get()
  @RequirePermissions('sales.create')
  @ZodResponse({ type: ChargeListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ChargesQueryDto) {
    return this.svc.list(t, q);
  }

  @Get(':id')
  @RequirePermissions('sales.create')
  @ZodResponse({ type: ChargeDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  /** Pregunta el estado a la pasarela ahora mismo. */
  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.create')
  @ZodResponse({ type: ChargeDto })
  refresh(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.refresh(t, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.create')
  @ZodResponse({ type: ChargeDto })
  cancel(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.cancel(t, id);
  }
}

/** Devoluciones de cobros en línea (adelantos y ventas anuladas). Las ejecuta el worker. */
@ApiTags('shop · pagos en línea')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/payment-refunds')
export class RefundsController {
  constructor(private readonly svc: RefundsService) {}

  @Get()
  @RequirePermissions('sales.view_all')
  @ZodResponse({ type: RefundListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: RefundsQueryDto) {
    return this.svc.list(t, q);
  }

  /** Reintentar ahora una devolución pendiente o fallida. */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ZodResponse({ type: RefundDto })
  retry(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.retry(t, id);
  }
}
