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
  CategoryDto,
  CategoryListDto,
  CreateCategoryDto,
  CreateServiceDto,
  ReorderDto,
  ServiceDto,
  ServiceListDto,
  ServicesQueryDto,
  UpdateServiceDto,
} from './services.dto';
import { ServicesService } from './services.service';

@ApiTags('shop · servicios')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  @Get('service-categories')
  @ZodResponse({ type: CategoryListDto })
  categories(@CurrentTenant() t: TenantContext) {
    return this.svc.listCategories(t);
  }

  @Post('service-categories')
  @RequirePermissions('services.manage')
  @ZodResponse({ type: CategoryDto, status: 201 })
  createCategory(@CurrentTenant() t: TenantContext, @Body() dto: CreateCategoryDto) {
    return this.svc.createCategory(t, dto.name);
  }

  @Put('service-categories/order')
  @RequirePermissions('services.manage')
  @ZodResponse({ type: CategoryListDto })
  reorderCategories(@CurrentTenant() t: TenantContext, @Body() dto: ReorderDto) {
    return this.svc.reorderCategories(t, dto.ids);
  }

  @Patch('service-categories/:id')
  @RequirePermissions('services.manage')
  @ZodResponse({ type: CategoryDto })
  renameCategory(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.svc.renameCategory(t, id, dto.name);
  }

  @Delete('service-categories/:id')
  @RequirePermissions('services.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeCategory(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.removeCategory(t, id);
  }

  @Get('services')
  @ZodResponse({ type: ServiceListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ServicesQueryDto) {
    return this.svc.list(t, q);
  }

  @Post('services')
  @RequirePermissions('services.manage')
  @ZodResponse({ type: ServiceDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateServiceDto) {
    return this.svc.create(t, dto);
  }

  @Put('services/order')
  @RequirePermissions('services.manage')
  @ZodResponse({ type: ServiceListDto })
  reorder(@CurrentTenant() t: TenantContext, @Body() dto: ReorderDto) {
    return this.svc.reorder(t, dto.ids);
  }

  @Get('services/:id')
  @ZodResponse({ type: ServiceDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  @Patch('services/:id')
  @RequirePermissions('services.manage')
  @ZodResponse({ type: ServiceDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Delete('services/:id')
  @RequirePermissions('services.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(t, id);
  }
}
