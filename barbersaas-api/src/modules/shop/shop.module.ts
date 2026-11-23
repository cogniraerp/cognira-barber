import { Module } from '@nestjs/common';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';
import { CashController } from './cash/cash.controller';
import { CommissionsController } from './commissions/commissions.controller';
import { CommissionsService } from './commissions/commissions.service';
import { SalesController } from './sales/sales.controller';
import { SalesService } from './sales/sales.service';
import { CashService } from './cash/cash.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';
import { StaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';
import { UploadsController } from './uploads/uploads.controller';

/** Panel de la barbería (owner/admin). Todas las rutas bajo /v1/shop y con @TenantScoped. */
@Module({
  controllers: [
    ProfileController,
    UploadsController,
    MembersController,
    RolesController,
    InventoryController,
    CashController,
    SalesController,
    CommissionsController,
    ReportsController,
    OnboardingController,
    LocationsController,
    ServicesController,
    StaffController,
  ],
  providers: [
    ProfileService,
    MembersService,
    RolesService,
    InventoryService,
    CashService,
    SalesService,
    CommissionsService,
    ReportsService,
    OnboardingService,
    LocationsService,
    ServicesService,
    StaffService,
  ],
})
export class ShopModule {}
