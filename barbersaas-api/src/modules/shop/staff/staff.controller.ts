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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import { ReorderDto, SetStaffServicesDto } from '../services/services.dto';
import {
  CreateStaffDto,
  CreateTimeOffDto,
  StaffDto,
  StaffListDto,
  StaffQueryDto,
  StaffServiceListDto,
  StaffWeekDto,
  StaffWeekResponseDto,
  TimeOffDto,
  TimeOffListDto,
  TimeOffQueryDto,
  UpdateStaffDto,
} from './staff.dto';
import { StaffService } from './staff.service';

@ApiTags('shop · barberos')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/staff')
export class StaffController {
  constructor(private readonly svc: StaffService) {}

  @Get()
  @ZodResponse({ type: StaffListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: StaffQueryDto) {
    return this.svc.list(t, q);
  }

  @Post()
  @RequirePermissions('staff.manage')
  @ZodResponse({ type: StaffDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateStaffDto) {
    return this.svc.create(t, dto);
  }

  @Put('order')
  @RequirePermissions('staff.manage')
  @ZodResponse({ type: StaffListDto })
  reorder(@CurrentTenant() t: TenantContext, @Body() dto: ReorderDto) {
    return this.svc.reorder(t, dto.ids);
  }

  @Get(':id')
  @ZodResponse({ type: StaffDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  @Patch(':id')
  @RequirePermissions('staff.manage')
  @ZodResponse({ type: StaffDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(t, id);
  }

  @Get(':id/hours')
  @ZodResponse({ type: StaffWeekResponseDto })
  getHours(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.getHours(t, id);
  }

  @Put(':id/hours')
  @RequirePermissions('schedules.manage')
  @ZodResponse({ type: StaffWeekResponseDto })
  setHours(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: StaffWeekDto,
  ) {
    return this.svc.setHours(t, id, dto);
  }

  /** staff.manage, o el propio barbero (solo bloqueos). */
  @Get(':id/time-off')
  @ZodResponse({ type: TimeOffListDto })
  listTimeOff(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query() q: TimeOffQueryDto,
  ) {
    return this.svc.listTimeOff(t, id, q);
  }

  @Post(':id/time-off')
  @ZodResponse({ type: TimeOffDto, status: 201 })
  addTimeOff(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: CreateTimeOffDto,
  ) {
    return this.svc.addTimeOff(t, id, dto);
  }

  @Delete(':id/time-off/:timeOffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeTimeOff(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('timeOffId', UuidPipe) timeOffId: string,
  ): Promise<void> {
    await this.svc.removeTimeOff(t, id, timeOffId);
  }

  @Get(':id/services')
  @ZodResponse({ type: StaffServiceListDto })
  services(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.listServices(t, id);
  }

  /** Reemplazo completo: qué servicios hace y con qué precio/duración propios. */
  @Put(':id/services')
  @RequirePermissions('staff.manage')
  @ZodResponse({ type: StaffServiceListDto })
  setServices(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: SetStaffServicesDto,
  ) {
    return this.svc.setServices(t, id, dto.items);
  }
}
