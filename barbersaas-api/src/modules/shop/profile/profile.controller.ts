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
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { AllowSuspended, CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  BookingRulesDto,
  BrandingDto,
  CreateGalleryImageDto,
  GalleryImageDto,
  GalleryListDto,
  GeneralSettingsDto,
  PermissionMatrixDto,
  ProfileDto,
  ReorderDto,
  UpdateBrandingDto,
  UpdateGalleryImageDto,
  UpdateGeneralSettingsDto,
  UpdatePermissionsDto,
  UpdateProfileDto,
} from './profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('shop · perfil y configuración')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop')
export class ProfileController {
  constructor(private readonly svc: ProfileService) {}

  @Get('profile')
  @ZodResponse({ type: ProfileDto })
  getProfile(@CurrentTenant() t: TenantContext) {
    return this.svc.getProfile(t);
  }

  @Patch('profile')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: ProfileDto })
  updateProfile(@CurrentTenant() t: TenantContext, @Body() dto: UpdateProfileDto) {
    return this.svc.updateProfile(t, dto);
  }

  @Get('branding')
  // El panel muestra el logo también en la pantalla de "barbería pausada".
  @AllowSuspended()
  @ZodResponse({ type: BrandingDto })
  getBranding(@CurrentTenant() t: TenantContext) {
    return this.svc.getBranding(t);
  }

  @Patch('branding')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: BrandingDto })
  updateBranding(@CurrentTenant() t: TenantContext, @Body() dto: UpdateBrandingDto) {
    return this.svc.updateBranding(t, dto);
  }

  @Get('gallery')
  @ZodResponse({ type: GalleryListDto })
  listGallery(@CurrentTenant() t: TenantContext) {
    return this.svc.listGallery(t);
  }

  @Post('gallery')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: GalleryImageDto, status: 201 })
  addGallery(@CurrentTenant() t: TenantContext, @Body() dto: CreateGalleryImageDto) {
    return this.svc.addGalleryImage(t, dto);
  }

  @Put('gallery/order')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: GalleryListDto })
  reorderGallery(@CurrentTenant() t: TenantContext, @Body() dto: ReorderDto) {
    return this.svc.reorderGallery(t, dto.ids);
  }

  @Patch('gallery/:id')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: GalleryImageDto })
  updateGallery(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateGalleryImageDto,
  ) {
    return this.svc.updateGalleryImage(t, id, dto);
  }

  @Delete('gallery/:id')
  @RequirePermissions('shop.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeGallery(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.removeGalleryImage(t, id);
  }

  @Get('settings/booking-rules')
  @ZodResponse({ type: BookingRulesDto })
  getBookingRules(@CurrentTenant() t: TenantContext) {
    return this.svc.getBookingRules(t);
  }

  @Put('settings/booking-rules')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: BookingRulesDto })
  setBookingRules(@CurrentTenant() t: TenantContext, @Body() dto: BookingRulesDto) {
    return this.svc.setBookingRules(t, dto);
  }

  @Get('settings/general')
  @ZodResponse({ type: GeneralSettingsDto })
  getGeneral(@CurrentTenant() t: TenantContext) {
    return this.svc.getGeneral(t);
  }

  @Patch('settings/general')
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: GeneralSettingsDto })
  updateGeneral(@CurrentTenant() t: TenantContext, @Body() dto: UpdateGeneralSettingsDto) {
    return this.svc.updateGeneral(t, dto);
  }

  @Get('settings/permissions')
  @RequirePermissions('members.manage')
  @ZodResponse({ type: PermissionMatrixDto })
  getPermissions(@CurrentTenant() t: TenantContext) {
    return this.svc.getPermissionMatrix(t);
  }

  @Put('settings/permissions')
  @RequirePermissions('members.manage')
  @ZodResponse({ type: PermissionMatrixDto })
  setPermissions(@CurrentTenant() t: TenantContext, @Body() dto: UpdatePermissionsDto) {
    return this.svc.setPermissionMatrix(t, dto);
  }
}
