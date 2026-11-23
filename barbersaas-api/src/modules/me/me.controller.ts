import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/auth/auth.types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AccountRecoveryService } from '../auth/account-recovery.service';
import {
  CreateMyBarbershopDto,
  CreatedBarbershopDto,
  MeDto,
  MyBarbershopsDto,
  UpdateMeDto,
} from './me.dto';
import { SignupService } from './signup.service';

const meSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  locale: true,
  platformRole: true,
  emailVerifiedAt: true,
} as const;

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signup: SignupService,
    private readonly recovery: AccountRecoveryService,
  ) {}

  /** Reenvía el link para confirmar el correo (409 si ya está verificado; 429 si fue hace < 1 min). */
  @Post('email/resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiNoContentResponse()
  async resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    await this.recovery.sendVerification(user.userId, true);
  }

  /** Alta self-service: crea la barbería con el plan por defecto en prueba y te deja como owner. */
  @Post('barbershops')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ZodResponse({ type: CreatedBarbershopDto, status: 201 })
  createBarbershop(@CurrentUser() user: AuthUser, @Body() dto: CreateMyBarbershopDto) {
    return this.signup.create(user.userId, dto);
  }

  @Get()
  @ZodResponse({ type: MeDto })
  get(@CurrentUser() user: AuthUser) {
    return this.prisma.run({ kind: 'user', userId: user.userId }, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: user.userId }, select: meSelect }),
    );
  }

  @Patch()
  @ZodResponse({ type: MeDto })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.prisma.run({ kind: 'user', userId: user.userId }, (tx) =>
      tx.user.update({ where: { id: user.userId }, data: dto, select: meSelect }),
    );
  }

  /** Barberías en las que el usuario es miembro activo (selector de barbería del panel). */
  @Get('barbershops')
  @ZodResponse({ type: MyBarbershopsDto })
  async barbershops(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.run({ kind: 'user', userId: user.userId }, (tx) =>
      tx.membership.findMany({
        where: {
          userId: user.userId,
          status: 'active',
          deletedAt: null,
          barbershop: { deletedAt: null },
        },
        select: {
          role: true,
          barbershop: {
            select: { id: true, slug: true, name: true, status: true, branding: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(({ role, barbershop: b }) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      status: b.status,
      role,
      logoUrl: readLogo(b.branding),
    }));
  }
}

function readLogo(branding: unknown): string | null {
  if (branding && typeof branding === 'object' && 'logoUrl' in branding) {
    const v = branding.logoUrl;
    return typeof v === 'string' ? v : null;
  }
  return null;
}
