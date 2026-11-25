import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformWhatsAppController } from './whatsapp/platform-whatsapp.controller';
import { BarbershopsModule } from '../barbershops/barbershops.module';
import { PlatformUsersController } from './users/platform-users.controller';
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
  imports: [BarbershopsModule, AuthModule, NotificationsModule],
  controllers: [
    PlatformWhatsAppController,
    PlatformUsersController,
    PlansController,
    PlatformBarbershopsController,
    PlatformBillingController,
    DashboardController,
    AuditLogsController,
  ],
  providers: [PlansService, PlatformBarbershopsService, PlatformBillingService, DashboardService],
})
export class PlatformModule {}
