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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  CreateMovementDto,
  CreateProductDto,
  ListMovementsQueryDto,
  ListProductsQueryDto,
  MovementListDto,
  MovementResultDto,
  ProductCategoriesDto,
  ProductDto,
  ProductListDto,
  UpdateProductDto,
} from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('shop · productos e inventario')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  /** Ver: products.manage, inventory.manage o cash.manage (cualquiera). */
  @Get('products')
  @ZodResponse({ type: ProductListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ListProductsQueryDto) {
    return this.svc.list(t, q);
  }

  @Get('products/categories')
  @ZodResponse({ type: ProductCategoriesDto })
  categories(@CurrentTenant() t: TenantContext) {
    return this.svc.categories(t);
  }

  @Get('products/:id')
  @ZodResponse({ type: ProductDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  @Post('products')
  @RequirePermissions('products.manage')
  @ZodResponse({ type: ProductDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateProductDto) {
    return this.svc.create(t, dto);
  }

  @Patch('products/:id')
  @RequirePermissions('products.manage')
  @ZodResponse({ type: ProductDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Delete('products/:id')
  @RequirePermissions('products.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(t, id);
  }

  @Get('inventory/movements')
  @ZodResponse({ type: MovementListDto })
  movements(@CurrentTenant() t: TenantContext, @Query() q: ListMovementsQueryDto) {
    return this.svc.movements(t, q);
  }

  /** Ingreso de compra o ajuste (conteo) de varios productos en una sede. */
  @Post('inventory/movements')
  @RequirePermissions('inventory.manage')
  @ZodResponse({ type: MovementResultDto, status: 201 })
  createMovements(@CurrentTenant() t: TenantContext, @Body() dto: CreateMovementDto) {
    return this.svc.createMovements(t, dto);
  }
}
