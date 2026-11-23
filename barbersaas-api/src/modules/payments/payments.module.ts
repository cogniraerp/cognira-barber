import { Module } from '@nestjs/common';
import { GatewayAccountsService } from './accounts.service';
import { PlatformGatewayController, ShopBillingController } from './billing.controller';
import { ChargesService } from './charges.service';
import { InvoicePayService } from './invoice-pay.service';
import { RefundsService } from './refunds.service';
import {
  ChargesController,
  GatewayAccountsController,
  RefundsController,
} from './payments.controller';
import {
  PaymentWebhooksController,
  PlatformPaymentWebhooksController,
  SimulatorCheckoutController,
} from './payments-public.controller';
import { PlatformGatewayService } from './platform-gateway.service';
import { GatewayRegistry } from './providers/registry';

/**
 * Pagos en línea (Fase 2 · paso 25): la pasarela propia de cada barbería (cobros en caja) y la
 * de la plataforma (pago de la suscripción).
 */
@Module({
  controllers: [
    GatewayAccountsController,
    ChargesController,
    RefundsController,
    ShopBillingController,
    PlatformGatewayController,
    PaymentWebhooksController,
    PlatformPaymentWebhooksController,
    SimulatorCheckoutController,
  ],
  providers: [
    GatewayRegistry,
    GatewayAccountsService,
    ChargesService,
    PlatformGatewayService,
    InvoicePayService,
    RefundsService,
  ],
  exports: [ChargesService, RefundsService],
})
export class PaymentsModule {}
