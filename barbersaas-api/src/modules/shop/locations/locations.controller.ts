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
import {
  CreateExceptionDto,
  CreateHolidayDto,
  CreateLocationDto,
  ExceptionDto,
  ExceptionListDto,
  ExceptionsQueryDto,
  HolidayDto,
  HolidayListDto,
  HolidaysQueryDto,
  ImportHolidaysDto,
  ImportHolidaysResultDto,
  LocationDto,
  LocationListDto,
  LocationWeekDto,
  LocationWeekResponseDto,
  UpdateLocationDto,
} from './locations.dto';
import { LocationsService } from './locations.service';

@ApiTags('shop · sedes y horarios')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop')
export class LocationsController {
  constructor(private readonly svc: LocationsService) {}

  @Get('locations')
  @ZodResponse({ type: LocationListDto })
  list(@CurrentTenant() t: TenantContext) {
    return this.svc.list(t);
  }

  @Post('locations')
  @RequirePermissions('locations.manage')
  @ZodResponse({ type: LocationDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateLocationDto) {
    return this.svc.create(t, dto);
  }

  @Patch('locations/:id')
  @RequirePermissions('locations.manage')
  @ZodResponse({ type: LocationDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Delete('locations/:id')
  @RequirePermissions('locations.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(t, id);
  }

  @Post('locations/:id/make-primary')
  @RequirePermissions('locations.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: LocationDto })
  makePrimary(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.makePrimary(t, id);
  }

  @Get('locations/:id/hours')
  @ZodResponse({ type: LocationWeekResponseDto })
  getHours(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.getHours(t, id);
  }

  @Put('locations/:id/hours')
  @RequirePermissions('schedules.manage')
  @ZodResponse({ type: LocationWeekResponseDto })
  setHours(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: LocationWeekDto,
  ) {
    return this.svc.setHours(t, id, dto);
  }

  @Get('holidays')
  @ZodResponse({ type: HolidayListDto })
  holidays(@CurrentTenant() t: TenantContext, @Query() q: HolidaysQueryDto) {
    return this.svc.listHolidays(t, q.year);
  }

  @Post('holidays')
  @RequirePermissions('schedules.manage')
  @ZodResponse({ type: HolidayDto, status: 201 })
  addHoliday(@CurrentTenant() t: TenantContext, @Body() dto: CreateHolidayDto) {
    return this.svc.addHoliday(t, dto);
  }

  @Post('holidays/import-pe')
  @RequirePermissions('schedules.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ImportHolidaysResultDto })
  importPeru(@CurrentTenant() t: TenantContext, @Body() dto: ImportHolidaysDto) {
    return this.svc.importPeru(t, dto.year);
  }

  @Delete('holidays/:id')
  @RequirePermissions('schedules.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeHoliday(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.removeHoliday(t, id);
  }

  @Get('schedule-exceptions')
  @ZodResponse({ type: ExceptionListDto })
  exceptions(@CurrentTenant() t: TenantContext, @Query() q: ExceptionsQueryDto) {
    return this.svc.listExceptions(t, q);
  }

  @Post('schedule-exceptions')
  @RequirePermissions('schedules.manage')
  @ZodResponse({ type: ExceptionDto, status: 201 })
  addException(@CurrentTenant() t: TenantContext, @Body() dto: CreateExceptionDto) {
    return this.svc.addException(t, dto);
  }

  @Delete('schedule-exceptions/:id')
  @RequirePermissions('schedules.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeException(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.removeException(t, id);
  }
}
