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
import type { AuthUser } from '../../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../../common/auth/decorators';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import {
  BarbershopDetailDto,
  BarbershopListDto,
  ChangePlanDto,
  CreateBarbershopDto,
  CreateBarbershopResultDto,
  ExtendTrialDto,
  ImpersonationDto,
  InviteLinkDto,
  ListBarbershopsQueryDto,
  ReasonDto,
  UpdateBarbershopDto,
} from './platform-barbershops.dto';
import { PlatformBarbershopsService } from './platform-barbershops.service';

@ApiTags('platform · barbershops')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/barbershops')
export class PlatformBarbershopsController {
  constructor(private readonly shops: PlatformBarbershopsService) {}

  @Get()
  @PlatformRoles('superadmin', 'support')
  @ZodResponse({ type: BarbershopListDto })
  list(@CurrentUser() u: AuthUser, @Query() q: ListBarbershopsQueryDto) {
    return this.shops.list(u, q);
  }

  @Get(':id')
  @PlatformRoles('superadmin', 'support')
  @ZodResponse({ type: BarbershopDetailDto })
  detail(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.shops.detail(u, id);
  }

  @Post()
  @ZodResponse({ type: CreateBarbershopResultDto, status: 201 })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBarbershopDto) {
    return this.shops.create(u, dto);
  }

  @Patch(':id')
  @ZodResponse({ type: BarbershopDetailDto })
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateBarbershopDto,
  ) {
    return this.shops.update(u, id, dto);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: BarbershopDetailDto })
  suspend(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: ReasonDto) {
    return this.shops.suspend(u, id, dto.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: BarbershopDetailDto })
  reactivate(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.shops.reactivate(u, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<void> {
    await this.shops.remove(u, id, dto.reason);
  }

  /** Enlace de invitación de un miembro invitado (p. ej. el dueño de una barbería creada aquí). */
  @Post(':id/members/:memberId/invite-link')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: InviteLinkDto })
  inviteLink(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('memberId', UuidPipe) memberId: string,
  ) {
    return this.shops.inviteLink(u, id, memberId);
  }

  @Post(':id/extend-trial')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: BarbershopDetailDto })
  extendTrial(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ExtendTrialDto,
  ) {
    return this.shops.extendTrial(u, id, dto);
  }

  @Post(':id/change-plan')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: BarbershopDetailDto })
  changePlan(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.shops.changePlan(u, id, dto);
  }

  /** Soporte también puede impersonar (sin acceso a facturación dentro de la barbería). */
  @Post(':id/impersonate')
  @PlatformRoles('superadmin', 'support')
  @ZodResponse({ type: ImpersonationDto, status: 201 })
  impersonate(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.shops.impersonate(u, id);
  }
}
