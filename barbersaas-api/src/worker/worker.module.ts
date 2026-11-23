import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ConfigModule } from '../config/config.module';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { BillingModule } from '../modules/billing/billing.module';
import { DepositsModule } from '../modules/deposits/deposits.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { WorkerService } from './worker.service';

/** Proceso worker (APP_MODE=worker): sin HTTP. Cola de mensajes y cobranza de suscripciones. */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CommonModule,
    NotificationsModule,
    BillingModule,
    DepositsModule,
    PaymentsModule,
  ],
  providers: [WorkerService],
})
export class WorkerModule {}
