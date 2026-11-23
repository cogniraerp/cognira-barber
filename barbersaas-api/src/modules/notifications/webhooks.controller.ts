import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { MessageStatus } from '../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { verifyTwilioSignature } from './providers/twilio';
import type { TwilioCredentials } from './providers/types';
import { SenderRegistry } from './sender-registry';

/** Orden de los estados: un webhook nunca "retrocede" un mensaje (llegan desordenados y repetidos). */
const RANK: Record<MessageStatus, number> = {
  queued: 0,
  sending: 0,
  manual: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 1,
};

/**
 * Webhooks de proveedores. Idempotentes: procesar el mismo evento dos veces deja el mismo resultado.
 * Se resuelven en contexto 'system' porque llegan sin usuario ni barbería; la firma es la autenticación.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('Webhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: SenderRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Verificación de suscripción de Meta (hub.challenge). */
  @Get('whatsapp')
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token && safeEqual(token, this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN))
      return challenge;
    throw AppError.forbidden('Token de verificación inválido');
  }

  @Post('whatsapp')
  @HttpCode(HttpStatus.OK)
  async whatsapp(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: MetaPayload,
  ): Promise<{ ok: true }> {
    this.assertMetaSignature(req);
    await this.prisma.run({ kind: 'system' }, async (tx) => {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const v = change.value ?? {};
          for (const st of v.statuses ?? []) {
            const status = META_STATUS[st.status ?? ''];
            if (!st.id || !status) continue;
            const at = st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date();
            const err = st.errors?.[0];
            await applyProviderStatus(
              tx,
              st.id,
              status,
              at,
              err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim() : undefined,
            );
          }
          if (change.field === 'message_template_status_update' && v.message_template_name) {
            const s = (v.event ?? '').toUpperCase();
            const providerStatus =
              s === 'APPROVED'
                ? 'approved'
                : s === 'REJECTED' || s === 'DISABLED'
                  ? 'rejected'
                  : s === 'PENDING'
                    ? 'pending'
                    : null;
            if (providerStatus) {
              await tx.messageTemplate.updateMany({
                where: { providerTemplateName: v.message_template_name },
                data: { providerStatus },
              });
            }
          }
        }
      }
    });
    return { ok: true };
  }

  /** StatusCallback de Twilio (application/x-www-form-urlencoded). */
  @Post('twilio')
  @HttpCode(HttpStatus.OK)
  async twilio(@Req() req: Request, @Body() body: Record<string, string>): Promise<{ ok: true }> {
    const sid = body.MessageSid;
    const status = TWILIO_STATUS[body.MessageStatus ?? ''];
    if (!sid) throw AppError.forbidden();
    await this.prisma.run({ kind: 'system' }, async (tx) => {
      const log = await tx.messageLog.findUnique({
        where: { providerMessageId: sid },
        select: { barbershopId: true },
      });
      if (!log) return; // desconocido: se ignora sin revelar nada
      const cfg = await tx.whatsappConfig.findUnique({ where: { barbershopId: log.barbershopId } });
      const creds = cfg?.provider === 'twilio' ? this.senders.creds<TwilioCredentials>(cfg) : null;
      const url = `${this.env.PUBLIC_API_URL.replace(/\/$/, '')}/v1/webhooks/twilio`;
      if (
        !creds ||
        !verifyTwilioSignature(creds.authToken, url, body, req.header('x-twilio-signature'))
      ) {
        throw AppError.forbidden('Firma de Twilio inválida');
      }
      if (status)
        await applyProviderStatus(
          tx,
          sid,
          status,
          new Date(),
          body.ErrorCode ? `Twilio ${body.ErrorCode}` : undefined,
        );
    });
    return { ok: true };
  }

  /** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, cuerpo crudo). */
  private assertMetaSignature(req: Request & { rawBody?: Buffer }): void {
    const secret = this.env.META_APP_SECRET;
    if (!secret) {
      if (this.env.NODE_ENV === 'production') throw AppError.forbidden('Webhook no configurado');
      this.logger.warn(
        'META_APP_SECRET vacío: se acepta el webhook SIN verificar firma (solo fuera de producción)',
      );
      return;
    }
    const given = req.header('x-hub-signature-256') ?? '';
    const expected = `sha256=${createHmac('sha256', secret)
      .update(req.rawBody ?? Buffer.alloc(0))
      .digest('hex')}`;
    if (!safeEqual(given, expected)) throw AppError.forbidden('Firma inválida');
  }
}

/** Aplica un estado del proveedor solo si avanza (o falla un mensaje aún no entregado). */
export async function applyProviderStatus(
  tx: Tx,
  providerMessageId: string,
  status: MessageStatus,
  at: Date,
  error?: string,
): Promise<void> {
  const log = await tx.messageLog.findUnique({
    where: { providerMessageId },
    select: { id: true, status: true },
  });
  if (!log) return;
  const current = RANK[log.status];
  if (
    status === 'failed'
      ? current >= RANK.delivered || log.status === 'failed'
      : RANK[status] <= current
  )
    return;
  await tx.messageLog.update({
    where: { id: log.id },
    data: {
      status,
      ...(status === 'delivered' ? { deliveredAt: at } : {}),
      ...(status === 'read' ? { readAt: at, deliveredAt: undefined } : {}),
      ...(status === 'failed' ? { error: error ?? 'Falló en el proveedor' } : {}),
    },
  });
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const META_STATUS: Record<string, MessageStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};
const TWILIO_STATUS: Record<string, MessageStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
};

interface MetaPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
        event?: string;
        message_template_name?: string;
      };
    }>;
  }>;
}
