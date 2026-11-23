import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../../common/auth/decorators';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import type { TenantContext } from '../../common/tenancy/tenant.types';
import { DomainDto, ResolvedDomainDto, SetDomainDto } from './domains.dto';
import { DomainsService } from './domains.service';

@ApiTags('shop')
@ApiBearerAuth()
@TenantScoped()
@RequirePermissions('shop.manage')
@Controller('shop/domain')
export class ShopDomainController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @ZodResponse({ type: DomainDto })
  get(@CurrentTenant() t: TenantContext) {
    return this.domains.get(t);
  }

  @Put()
  @ZodResponse({ type: DomainDto })
  set(@CurrentTenant() t: TenantContext, @Body() dto: SetDomainDto) {
    return this.domains.set(t, dto.domain);
  }

  /** Consulta el DNS ahora (limitado: cada consulta sale a internet). */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ZodResponse({ type: DomainDto })
  verify(@CurrentTenant() t: TenantContext) {
    return this.domains.verify(t);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@CurrentTenant() t: TenantContext): Promise<void> {
    await this.domains.remove(t);
  }
}

@ApiTags('public')
@Public()
@Controller('public')
export class PublicDomainController {
  constructor(private readonly domains: DomainsService) {}

  /** La web, abierta en un dominio propio, pregunta de qué barbería es. */
  @Get('resolve-domain')
  @ZodResponse({ type: ResolvedDomainDto })
  resolve(@Query('host') host = '') {
    return this.domains.resolve(String(host));
  }
}
