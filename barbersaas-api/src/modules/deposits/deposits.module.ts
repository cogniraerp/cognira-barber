import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { DepositsService } from './deposits.service';

/** Adelantos al reservar (Fase 3). El worker ejecuta el vencimiento de los apartados. */
@Module({
  imports: [PaymentsModule],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
