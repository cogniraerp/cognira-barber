import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../../common/auth/decorators';
import { PlatformDashboardDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('platform · dashboard')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ZodResponse({ type: PlatformDashboardDto })
  get(@CurrentUser() u: AuthUser) {
    return this.dashboard.get(u);
  }
}
