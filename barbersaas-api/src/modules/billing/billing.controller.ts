import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../common/auth/decorators';
import { CollectionsDto, DunningRunDto } from './collections.dto';
import { CollectionsService } from './collections.service';
import { DunningService } from './dunning.service';

/** Cobranza de suscripciones. Solo superadmin. */
@ApiTags('platform · billing')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/collections')
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly dunning: DunningService,
  ) {}

  @Get()
  @ZodResponse({ type: CollectionsDto })
  overview(@CurrentUser() u: AuthUser) {
    return this.collections.overview(u);
  }

  /** Ejecuta la cobranza ahora (el worker la corre solo cada hora). */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: DunningRunDto })
  run() {
    return this.dunning.run();
  }
}
