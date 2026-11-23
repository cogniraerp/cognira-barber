import { HttpStatus, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { IsoDate } from '../../common/http/zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { readBranding } from '../shop/settings.schemas';
import { hashInviteToken } from './invite-token';

const InvitationSchema = z.object({
  barbershop: z.object({ name: z.string(), slug: z.string(), logoUrl: z.string().nullable() }),
  role: z.enum(['owner', 'admin', 'receptionist', 'barber']),
  email: z.string(),
  expiresAt: IsoDate,
  expired: z.boolean(),
});
class InvitationDto extends createZodDto(InvitationSchema, { codec: true }) {}

const AcceptedSchema = z.object({
  barbershopId: z.uuid(),
  slug: z.string(),
  role: z.enum(['owner', 'admin', 'receptionist', 'barber']),
});
class AcceptedDto extends createZodDto(AcceptedSchema) {}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * Aceptar invitaciones. Se resuelven en contexto 'system' porque quien llega con el enlace
 * todavía no es miembro de la barbería.
 */
@ApiTags('invitaciones')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get(':token')
  @Public()
  @ZodResponse({ type: InvitationDto })
  async get(@Param('token') token: string) {
    const inv = await this.find(token);
    return {
      barbershop: {
        name: inv.barbershop.name,
        slug: inv.barbershop.slug,
        logoUrl: readBranding(inv.barbershop.branding).logoUrl,
      },
      role: inv.role,
      email: maskEmail(inv.inviteEmail!),
      expiresAt: inv.inviteExpiresAt!,
      expired: inv.inviteExpiresAt! <= new Date(),
    };
  }

  /** Requiere sesión iniciada con el MISMO email al que se envió la invitación. */
  @Post(':token/accept')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: AcceptedDto })
  async accept(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    const inv = await this.find(token);
    if (inv.inviteExpiresAt! <= new Date()) {
      throw new AppError(
        ErrorCode.CONFLICT,
        HttpStatus.GONE,
        'La invitación venció: pide que te la reenvíen',
      );
    }
    if (inv.inviteEmail!.toLowerCase() !== user.email.toLowerCase()) {
      throw AppError.forbidden('Esta invitación es para otro email');
    }
    return this.prisma.run({ kind: 'system', barbershopId: inv.barbershopId }, async (tx) => {
      const already = await tx.membership.findFirst({
        where: { barbershopId: inv.barbershopId, userId: user.userId, deletedAt: null },
        select: { id: true },
      });
      if (already) throw AppError.conflict('Ya eres miembro de esta barbería');
      // Condicional: si dos pestañas aceptan a la vez, solo una gana.
      const claimed = await tx.membership.updateMany({
        where: { id: inv.id, status: 'invited', inviteToken: hashInviteToken(token) },
        data: { userId: user.userId, status: 'active', inviteToken: null, inviteExpiresAt: null },
      });
      if (claimed.count === 0) throw AppError.notFound('Invitación');
      await this.audit.record(tx, {
        action: 'shop.member.accept_invite',
        barbershopId: inv.barbershopId,
        entity: 'membership',
        entityId: inv.id,
      });
      return { barbershopId: inv.barbershopId, slug: inv.barbershop.slug, role: inv.role };
    });
  }

  private async find(token: string) {
    if (!TOKEN_RE.test(token)) throw AppError.notFound('Invitación');
    const inv = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.membership.findFirst({
        where: {
          inviteToken: hashInviteToken(token),
          status: 'invited',
          deletedAt: null,
          barbershop: { deletedAt: null },
        },
        select: {
          id: true,
          barbershopId: true,
          role: true,
          inviteEmail: true,
          inviteExpiresAt: true,
          barbershop: { select: { name: true, slug: true, branding: true } },
        },
      }),
    );
    if (!inv?.inviteEmail || !inv.inviteExpiresAt) throw AppError.notFound('Invitación');
    return inv;
  }
}

/** j***@gmail.com — se muestra para que la persona sepa con qué cuenta entrar, sin exponer el email completo. */
function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}
