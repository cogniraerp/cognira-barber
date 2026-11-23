import { Module } from '@nestjs/common';
import { BarbershopsModule } from '../barbershops/barbershops.module';
import { AuditLogsController } from './audit/audit-logs.controller';
import { PlatformBarbershopsController } from './barbershops/platform-barbershops.controller';
import { PlatformBarbershopsService } from './barbershops/platform-barbershops.service';
import { PlatformBillingController } from './billing/platform-billing.controller';
import { PlatformBillingService } from './billing/platform-billing.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { PlansController } from './plans/plans.controller';
import { PlansService } from './plans/plans.service';

/** Panel de Superadmin / Soporte. Todas las rutas bajo /v1/platform y con @PlatformRoles. */
@Module({
  imports: [BarbershopsModule],
  controllers: [
    PlansController,
    PlatformBarbershopsController,
    PlatformBillingController,
    DashboardController,
    AuditLogsController,
  ],
  providers: [PlansService, PlatformBarbershopsService, PlatformBillingService, DashboardService],
})
export class PlatformModule {}
