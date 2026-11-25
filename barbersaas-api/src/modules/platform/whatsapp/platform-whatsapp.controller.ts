import { Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { PlatformRoles } from '../../../common/auth/decorators';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { WhatsAppQrDto } from '../../notifications/notifications.dto';
import { SenderRegistry } from '../../notifications/sender-registry';

class PlatformWhatsAppDto extends createZodDto(
  z.object({
    /** Con qué sale el WhatsApp de la plataforma (WHATSAPP_PLATFORM_PROVIDER). */
    provider: z.enum(['cloud', 'evolution']),
    evolutionConfigured: z.boolean(),
    instance: z.string(),
    state: z.enum(['open', 'connecting', 'close', 'missing', 'unknown']),
    phone: z.string().nullable(),
  }),
) {}

/** El número de WhatsApp de Cognira (avisos de cobranza a las barberías), vinculado por QR. */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/whatsapp')
export class PlatformWhatsAppController {
  constructor(
    private readonly senders: SenderRegistry,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ZodResponse({ type: PlatformWhatsAppDto })
  async status() {
    const evo = this.senders.evolution();
    const instance = this.env.EVOLUTION_PLATFORM_INSTANCE;
    let state: PlatformWhatsAppDto['state'] = 'unknown';
    let phone: string | null = null;
    if (evo.configured) {
      state = await evo.state(instance).catch(() => 'unknown' as const);
      if (state === 'open') phone = await evo.phone(instance).catch(() => null);
    }
    return {
      provider: this.env.WHATSAPP_PLATFORM_PROVIDER,
      evolutionConfigured: evo.configured,
      instance,
      state,
      phone,
    };
  }

  @Post('qr')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: WhatsAppQrDto })
  async qr() {
    try {
      const r = await this.senders.evolution().qr(this.env.EVOLUTION_PLATFORM_INSTANCE);
      if (r.state === 'open')
        await this.prisma.run({ kind: 'system' }, (tx) =>
          this.audit.record(tx, {
            action: 'platform.whatsapp.qr_linked',
            diff: { phone: r.phone },
          }),
        );
      return r;
    } catch (e) {
      throw new AppError(ErrorCode.GATEWAY_ERROR, HttpStatus.BAD_GATEWAY, (e as Error).message);
    }
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PlatformWhatsAppDto })
  async disconnect() {
    try {
      await this.senders.evolution().logout(this.env.EVOLUTION_PLATFORM_INSTANCE);
    } catch (e) {
      throw new AppError(ErrorCode.GATEWAY_ERROR, HttpStatus.BAD_GATEWAY, (e as Error).message);
    }
    return this.status();
  }
}
