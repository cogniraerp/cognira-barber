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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../common/auth/decorators';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { AllowSuspended, CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import type { TenantContext } from '../../common/tenancy/tenant.types';
import { InvoicePayService } from './invoice-pay.service';
import {
  ConnectGatewayDto,
  GatewayAccountDto,
  GatewayOverviewDto,
  InvoiceChargeDto,
  ShopBillingDto,
  UpdateGatewayDto,
} from './payments.dto';
import { PlatformGatewayService } from './platform-gateway.service';

/** Mi suscripción: plan, facturas y pago en línea con la pasarela de la plataforma. */
@ApiTags('shop · suscripción')
@ApiBearerAuth()
@TenantScoped()
// Una barbería suspendida por falta de pago debe poder ver sus facturas y pagarlas.
@AllowSuspended()
@Controller('shop/billing')
export class ShopBillingController {
  constructor(private readonly svc: InvoicePayService) {}

  @Get()
  @RequirePermissions('billing.view')
  @ZodResponse({ type: ShopBillingDto })
  billing(@CurrentTenant() t: TenantContext) {
    return this.svc.billing(t);
  }

  /** Link de pago de una factura abierta (reutiliza el vigente si lo hay). */
  @Post('invoices/:id/pay')
  @RequirePermissions('billing.manage')
  @ZodResponse({ status: 201, type: InvoiceChargeDto })
  pay(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.pay(t, id);
  }

  @Get('charges/:id')
  @RequirePermissions('billing.view')
  @ZodResponse({ type: InvoiceChargeDto })
  charge(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  @Post('charges/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing.view')
  @ZodResponse({ type: InvoiceChargeDto })
  refresh(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.refresh(t, id);
  }
}

/** Pasarela con la que la plataforma cobra la suscripción. Solo superadmin. */
@ApiTags('platform · billing')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/payment-gateways')
export class PlatformGatewayController {
  constructor(private readonly svc: PlatformGatewayService) {}

  @Get()
  @ZodResponse({ type: GatewayOverviewDto })
  overview(@CurrentUser() u: AuthUser) {
    return this.svc.overview(u);
  }

  @Post()
  @ZodResponse({ status: 201, type: GatewayAccountDto })
  connect(@CurrentUser() u: AuthUser, @Body() dto: ConnectGatewayDto) {
    return this.svc.connect(u, dto);
  }

  @Patch(':id')
  @ZodResponse({ type: GatewayAccountDto })
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateGatewayDto,
  ) {
    return this.svc.update(u, id, dto);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: GatewayAccountDto })
  verify(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.svc.verify(u, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.svc.remove(u, id);
  }
}
