import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { CurrentUser, PlatformRoles, Public } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { platformDb } from '../../common/auth/platform-db';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { AllowSuspended, CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import {
  ComplaintDto,
  ComplaintListDto,
  ComplaintReceiptDto,
  ComplaintsQueryDto,
  CreateComplaintDto,
  ProviderInfoDto,
  RespondComplaintDto,
} from './complaints.dto';
import { ComplaintsService } from './complaints.service';

/**
 * Hojas por IP y hora (anti-spam). Usa el mismo tope que las reservas públicas
 * (`PUBLIC_BOOKINGS_PER_HOUR`, 10 por defecto), que en local/CI se sube para los E2E.
 */
const SUBMIT_THROTTLE = {
  default: { limit: () => Number(process.env.PUBLIC_BOOKINGS_PER_HOUR ?? 10), ttl: 3_600_000 },
};

@ApiTags('public')
@Public()
@Controller('public')
export class PublicComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  /** Datos legales de Cognira: páginas de Términos, Privacidad y su Libro de Reclamaciones. */
  @Get('legal')
  @ZodResponse({ type: ProviderInfoDto })
  legal() {
    return this.complaints.platformInfo();
  }

  @Post('complaints')
  @Throttle(SUBMIT_THROTTLE)
  @ZodResponse({ type: ComplaintReceiptDto, status: 201 })
  createForPlatform(@Body() dto: CreateComplaintDto) {
    return this.complaints.createForPlatform(dto);
  }

  @Get('shops/:slug/complaints-book')
  @ZodResponse({ type: ProviderInfoDto })
  shopBook(@Param('slug') slug: string) {
    return this.complaints.shopInfo(slug);
  }

  @Post('shops/:slug/complaints')
  @Throttle(SUBMIT_THROTTLE)
  @ZodResponse({ type: ComplaintReceiptDto, status: 201 })
  createForShop(@Param('slug') slug: string, @Body() dto: CreateComplaintDto) {
    return this.complaints.createForShop(slug, dto);
  }
}

/** El libro de la barbería, en su panel. Una barbería suspendida también debe responder. */
@ApiTags('shop')
@ApiBearerAuth()
@TenantScoped()
@AllowSuspended()
@RequirePermissions('complaints.manage')
@Controller('shop/complaints')
export class ShopComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @ZodResponse({ type: ComplaintListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ComplaintsQueryDto) {
    return this.complaints.list(tenantDb(t), { barbershopId: t.barbershopId }, q);
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ComplaintDto })
  respond(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: RespondComplaintDto,
  ) {
    return this.complaints.respond(
      tenantDb(t),
      { barbershopId: t.barbershopId },
      id,
      dto.response,
      t.userId,
    );
  }
}

/** El libro de Cognira, en el panel de plataforma. */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/complaints')
export class PlatformComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @PlatformRoles('superadmin', 'support')
  @ZodResponse({ type: ComplaintListDto })
  list(@CurrentUser() u: AuthUser, @Query() q: ComplaintsQueryDto) {
    return this.complaints.list(platformDb(u), { barbershopId: null }, q);
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ComplaintDto })
  respond(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: RespondComplaintDto,
  ) {
    return this.complaints.respond(
      platformDb(u),
      { barbershopId: null },
      id,
      dto.response,
      u.userId,
    );
  }
}
