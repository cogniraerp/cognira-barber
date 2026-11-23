import { Module } from '@nestjs/common';
import { CollectionsController } from './billing.controller';
import { CollectionsService } from './collections.service';
import { DunningService } from './dunning.service';
import { PlanChangeService } from './plan-change.service';
import { ShopPlanController } from './shop-plan.controller';

/** Cobranza de suscripciones (Fase 2 · paso 26). El worker ejecuta DunningService. */
@Module({
  controllers: [CollectionsController, ShopPlanController],
  providers: [DunningService, CollectionsService, PlanChangeService],
  exports: [DunningService],
})
export class BillingModule {}
