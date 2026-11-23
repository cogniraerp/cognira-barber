import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { pageArgs } from '../../common/http/zod';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import type { MessageChannel, MessageEvent } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { normalizePhone } from '../appointments/phone';
import { badRequest } from '../shop/shop-helpers';
import { NotificationSettingsSchema, readNotificationSettings } from '../shop/settings.schemas';
import {
  LogsQueryDto,
  MessageLogDto,
  MessageLogListDto,
  NotificationSettingsDto,
  PreviewDto,
  PreviewResultDto,
  SetTemplateDto,
  SetWhatsAppDto,
  TemplateDto,
  TemplateListDto,
  TemplateParamsDto,
  TestMessageDto,
  TestResultDto,
  UsageDto,
  WhatsAppConfigDto,
} from './notifications.dto';
import { ProviderError, type CloudApiCredentials, type TwilioCredentials } from './providers/types';
import { WhatsAppCloudSender } from './providers/whatsapp-cloud';
import { SenderRegistry } from './sender-registry';
import {
  DEFAULT_TEMPLATES,
  render,
  TEMPLATE_VARIABLES,
  unknownVariables,
  variablesInOrder,
  type TemplateVars,
} from './templates';

const EVENTS: MessageEvent[] = [
  'booking_requested',
  'booking_confirmed',
  'reminder',
  'rescheduled',
  'canceled',
  'staff_new_booking',
];
const CHANNELS: MessageChannel[] = ['whatsapp', 'email'];
const SAMPLE: TemplateVars = {
  cliente: 'Ana',
  servicio: 'Corte + barba',
  barbero: 'Carlos',
  fecha: 'lunes, 10 de noviembre',
  hora: '10:30 a. m.',
  sede: 'Sede principal',
  direccion: 'Av. Larco 345, Miraflores',
  barberia: 'Barbería Demo',
  link_cancelar: 'https://barbersaas.com/b/demo/cita/…',
  link_reprogramar: 'https://barbersaas.com/b/demo/cita/…',
  total: 'S/ 45.00',
};

@ApiTags('shop · WhatsApp y notificaciones')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop')
export class ShopNotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly senders: SenderRegistry,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
  ) {}

  // ─────────────── Conexión de WhatsApp ───────────────
  @Get('whatsapp')
  @RequirePermissions('whatsapp.manage')
  @ZodResponse({ type: WhatsAppConfigDto })
  getWhatsApp(@CurrentTenant() t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      this.view(await tx.whatsappConfig.findUnique({ where: { barbershopId: t.barbershopId } })),
    );
  }

  /** Las credenciales se guardan cifradas (AES-256-GCM) y nunca se devuelven. Cambiar de proveedor obliga a verificar de nuevo. */
  @Put('whatsapp')
  @RequirePermissions('whatsapp.manage')
  @ZodResponse({ type: WhatsAppConfigDto })
  setWhatsApp(@CurrentTenant() t: TenantContext, @Body() dto: SetWhatsAppDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const current = await tx.whatsappConfig.findUnique({
        where: { barbershopId: t.barbershopId },
      });
      let credentialsEnc: Uint8Array<ArrayBuffer> | null = null;
      let keyVersion = this.crypto.currentVersion;
      const credentials =
        dto.provider === 'cloud_api'
          ? dto.cloudApi
          : dto.provider === 'twilio'
            ? dto.twilio
            : undefined;
      if (dto.provider === 'cloud_api' || dto.provider === 'twilio') {
        if (credentials) {
          const enc = this.crypto.encryptJson(credentials);
          credentialsEnc = new Uint8Array(enc.data);
          keyVersion = enc.keyVersion;
        } else if (current?.provider === dto.provider && current.credentialsEnc) {
          credentialsEnc = new Uint8Array(current.credentialsEnc);
          keyVersion = current.keyVersion;
        } else {
          throw badRequest('credentials', 'Faltan las credenciales del proveedor');
        }
      }
      const data = {
        provider: dto.provider,
        credentialsEnc,
        keyVersion,
        status: 'unverified' as const,
        verifiedAt: null,
        lastError: null,
        displayPhone: null,
      };
      const row = await tx.whatsappConfig.upsert({
        where: { barbershopId: t.barbershopId },
        create: { barbershopId: t.barbershopId, ...data },
        update: data,
      });
      await this.audit.record(tx, {
        action: 'shop.whatsapp.configure',
        barbershopId: t.barbershopId,
        diff: { provider: dto.provider, credentialsUpdated: Boolean(credentials) },
      });
      return this.view(row);
    });
  }

  /** Prueba la conexión con el proveedor (Meta/Twilio). Con 'platform' o 'wa_me' queda lista de inmediato. */
  @Post('whatsapp/verify')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: WhatsAppConfigDto })
  async verify(@CurrentTenant() t: TenantContext) {
    const cfg = await this.prisma.run(tenantDb(t), (tx) =>
      tx.whatsappConfig.upsert({
        where: { barbershopId: t.barbershopId },
        create: { barbershopId: t.barbershopId },
        update: {},
      }),
    );
    let patch: {
      status: 'ok' | 'error';
      displayPhone?: string | null;
      lastError: string | null;
      verifiedAt: Date | null;
    };
    try {
      const sender = this.senders.whatsapp(cfg);
      if ('verify' in sender && typeof sender.verify === 'function') {
        const r = await sender.verify();
        patch = {
          status: 'ok',
          displayPhone: r.displayPhone,
          lastError: null,
          verifiedAt: new Date(),
        };
      } else {
        patch = { status: 'ok', lastError: null, verifiedAt: new Date() };
      }
    } catch (e) {
      patch = { status: 'error', lastError: (e as Error).message.slice(0, 300), verifiedAt: null };
    }
    return this.prisma.run(tenantDb(t), async (tx) =>
      this.view(
        await tx.whatsappConfig.update({ where: { barbershopId: t.barbershopId }, data: patch }),
      ),
    );
  }

  /** Envía un mensaje de prueba al número indicado (no cuenta para el límite del plan). */
  @Post('whatsapp/test')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: TestResultDto })
  async test(@CurrentTenant() t: TenantContext, @Body() dto: TestMessageDto) {
    const { cfg, country } = await this.prisma.run(tenantDb(t), async (tx) => ({
      cfg: await tx.whatsappConfig.findUnique({ where: { barbershopId: t.barbershopId } }),
      country: (
        await tx.barbershop.findUniqueOrThrow({
          where: { id: t.barbershopId },
          select: { country: true },
        })
      ).country,
    }));
    const to = normalizePhone(dto.to, country);
    if (!to) throw badRequest('to', 'Teléfono inválido');
    try {
      const sender = this.senders.whatsapp(cfg);
      const r = await sender.send({
        to,
        body: `✅ Mensaje de prueba de ${t.name}. ¡La conexión de WhatsApp funciona!`,
      });
      return {
        status: r.status,
        provider: sender.name,
        providerMessageId: r.providerMessageId,
        actionUrl: r.actionUrl ?? null,
      };
    } catch (e) {
      throw AppError.conflict(`El proveedor rechazó el mensaje: ${(e as Error).message}`);
    }
  }

  // ─────────────── Plantillas ───────────────
  @Get('message-templates')
  @RequirePermissions('whatsapp.manage')
  @ZodResponse({ type: TemplateListDto })
  async templates(@CurrentTenant() t: TenantContext) {
    const rows = await this.prisma.run(tenantDb(t), (tx) =>
      tx.messageTemplate.findMany({ where: { barbershopId: t.barbershopId, deletedAt: null } }),
    );
    const templates = EVENTS.flatMap((event) =>
      CHANNELS.map((channel) => {
        const custom = rows.find((r) => r.event === event && r.channel === channel);
        const def = DEFAULT_TEMPLATES[event][channel]!;
        return {
          event,
          channel,
          subject: channel === 'email' ? (custom?.subject ?? def.subject ?? null) : null,
          body: custom?.body ?? def.body,
          source: custom ? ('custom' as const) : ('default' as const),
          providerTemplateName: custom?.providerTemplateName ?? null,
          providerStatus: custom?.providerStatus ?? ('n_a' as const),
        };
      }),
    );
    return { variables: [...TEMPLATE_VARIABLES], templates };
  }

  @Put('message-templates/:event/:channel')
  @RequirePermissions('whatsapp.manage')
  @ZodResponse({ type: TemplateDto })
  async setTemplate(
    @CurrentTenant() t: TenantContext,
    @Param() p: TemplateParamsDto,
    @Body() dto: SetTemplateDto,
  ) {
    const unknown = unknownVariables(`${dto.subject ?? ''} ${dto.body}`);
    if (unknown.length)
      throw badRequest(
        'body',
        `Variables desconocidas: ${unknown.map((v) => `{{${v}}}`).join(', ')}`,
      );
    if (p.channel === 'whatsapp' && dto.body.length > 1024)
      throw badRequest('body', 'WhatsApp admite hasta 1024 caracteres');
    if (p.channel === 'email' && !dto.subject)
      throw badRequest('subject', 'El email necesita asunto');
    await this.prisma.run(tenantDb(t), async (tx) => {
      const existing = await tx.messageTemplate.findFirst({
        where: {
          barbershopId: t.barbershopId,
          event: p.event,
          channel: p.channel,
          deletedAt: null,
        },
        select: { id: true },
      });
      // Editar el texto invalida la aprobación de Meta: hay que reenviarla.
      const data = {
        subject: p.channel === 'email' ? dto.subject : null,
        body: dto.body,
        providerTemplateName: null,
        providerStatus: 'n_a' as const,
      };
      if (existing) await tx.messageTemplate.update({ where: { id: existing.id }, data });
      else
        await tx.messageTemplate.create({
          data: { ...data, barbershopId: t.barbershopId, event: p.event, channel: p.channel },
        });
    });
    return (await this.templates(t)).templates.find(
      (x) => x.event === p.event && x.channel === p.channel,
    )!;
  }

  @Delete('message-templates/:event/:channel')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async resetTemplate(
    @CurrentTenant() t: TenantContext,
    @Param() p: TemplateParamsDto,
  ): Promise<void> {
    await this.prisma.run(tenantDb(t), (tx) =>
      tx.messageTemplate.updateMany({
        where: {
          barbershopId: t.barbershopId,
          event: p.event,
          channel: p.channel,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      }),
    );
  }

  @Post('message-templates/preview')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: PreviewResultDto })
  async preview(@CurrentTenant() t: TenantContext, @Body() dto: PreviewDto) {
    const current = (await this.templates(t)).templates.find(
      (x) => x.event === dto.event && x.channel === dto.channel,
    )!;
    const vars = { ...SAMPLE, barberia: t.name };
    return {
      subject: dto.channel === 'email' ? render(dto.subject ?? current.subject ?? '', vars) : null,
      body: render(dto.body ?? current.body, vars),
    };
  }

  /**
   * Envía la plantilla de WhatsApp a aprobación de Meta (necesario para mensajes iniciados por la
   * barbería, como recordatorios). Solo con proveedor Cloud API verificado.
   */
  @Post('message-templates/:event/whatsapp/submit')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: TemplateDto })
  async submit(@CurrentTenant() t: TenantContext, @Param('event') eventRaw: string) {
    const event = TemplateParamsDto.schema.shape.event.parse(eventRaw);
    const { cfg, tpl } = await this.prisma.run(tenantDb(t), async (tx) => ({
      cfg: await tx.whatsappConfig.findUnique({ where: { barbershopId: t.barbershopId } }),
      tpl: (await this.templates(t)).templates.find(
        (x) => x.event === event && x.channel === 'whatsapp',
      )!,
    }));
    if (cfg?.provider !== 'cloud_api' || cfg.status !== 'ok')
      throw AppError.conflict('Conecta y verifica WhatsApp Cloud API antes de enviar plantillas');
    const order = variablesInOrder(tpl.body);
    let i = 0;
    const metaBody = tpl.body.replace(/\{\{\s*[a-z_]+\s*\}\}/g, () => `{{${++i}}}`);
    const name = `bs_${event}_${createHash('sha256').update(tpl.body).digest('hex').slice(0, 8)}`;
    const cloud = this.senders.whatsapp(cfg) as WhatsAppCloudSender;
    try {
      await cloud.submitTemplate({
        name,
        language: t.locale.startsWith('en') ? 'en' : 'es',
        body: metaBody,
        examples: order.map((v) => SAMPLE[v]),
      });
    } catch (e) {
      throw AppError.conflict(`Meta rechazó la plantilla: ${(e as ProviderError).message}`);
    }
    await this.prisma.run(tenantDb(t), async (tx) => {
      const data = { providerTemplateName: name, providerStatus: 'pending' as const };
      const existing = await tx.messageTemplate.findFirst({
        where: { barbershopId: t.barbershopId, event, channel: 'whatsapp', deletedAt: null },
        select: { id: true },
      });
      if (existing) await tx.messageTemplate.update({ where: { id: existing.id }, data });
      else
        await tx.messageTemplate.create({
          data: {
            ...data,
            barbershopId: t.barbershopId,
            event,
            channel: 'whatsapp',
            body: tpl.body,
          },
        });
    });
    return (await this.templates(t)).templates.find(
      (x) => x.event === event && x.channel === 'whatsapp',
    )!;
  }

  // ─────────────── Preferencias de notificación ───────────────
  @Get('settings/notifications')
  @ZodResponse({ type: NotificationSettingsDto })
  async getSettings(@CurrentTenant() t: TenantContext) {
    const s = await this.prisma.run(tenantDb(t), (tx) =>
      tx.barbershopSettings.findUnique({
        where: { barbershopId: t.barbershopId },
        select: { notifications: true },
      }),
    );
    return readNotificationSettings(s?.notifications);
  }

  @Put('settings/notifications')
  @RequirePermissions('whatsapp.manage')
  @ZodResponse({ type: NotificationSettingsDto })
  setSettings(@CurrentTenant() t: TenantContext, @Body() dto: NotificationSettingsDto) {
    const parsed = NotificationSettingsSchema.parse(dto);
    return this.prisma.run(tenantDb(t), async (tx) => {
      await tx.barbershopSettings.upsert({
        where: { barbershopId: t.barbershopId },
        create: { barbershopId: t.barbershopId, notifications: parsed },
        update: { notifications: parsed },
      });
      await this.audit.record(tx, {
        action: 'shop.settings.notifications',
        barbershopId: t.barbershopId,
        diff: parsed,
      });
      return parsed;
    });
  }

  // ─────────────── Registro de mensajes y uso ───────────────
  @Get('message-logs')
  @RequirePermissions('whatsapp.manage')
  @ZodResponse({ type: MessageLogListDto })
  async logs(@CurrentTenant() t: TenantContext, @Query() q: LogsQueryDto) {
    const where: Prisma.MessageLogWhereInput = {
      barbershopId: t.barbershopId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.appointmentId ? { appointmentId: q.appointmentId } : {}),
    };
    const [items, total] = await this.prisma.run(tenantDb(t), (tx) =>
      Promise.all([
        tx.messageLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.messageLog.count({ where }),
      ]),
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** wa.me: marcar como enviado después de tocar el enlace en el panel. */
  @Post('message-logs/:id/mark-sent')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: MessageLogDto })
  markSent(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const log = await findLog(tx, t.barbershopId, id);
      if (log.status !== 'manual')
        throw AppError.conflict('Solo los mensajes manuales (wa.me) se marcan a mano');
      return tx.messageLog.update({ where: { id }, data: { status: 'sent', sentAt: new Date() } });
    });
  }

  @Post('message-logs/:id/retry')
  @RequirePermissions('whatsapp.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: MessageLogDto })
  retry(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const log = await findLog(tx, t.barbershopId, id);
      if (log.status !== 'failed') throw AppError.conflict('Solo se reintentan mensajes fallidos');
      return tx.messageLog.update({
        where: { id },
        data: { status: 'queued', attempts: 0, error: null, scheduledFor: new Date() },
      });
    });
  }

  @Get('notifications/usage')
  @ZodResponse({ type: UsageDto })
  async usage(@CurrentTenant() t: TenantContext) {
    const period = new Date().toISOString().slice(0, 7);
    const { limits } = await this.plans.entitlements(t.barbershopId);
    const [used, queued] = await this.prisma.run(tenantDb(t), (tx) =>
      Promise.all([
        tx.usageCounter.findUnique({
          where: {
            barbershopId_period_metric: {
              barbershopId: t.barbershopId,
              period,
              metric: 'whatsappPerMonth',
            },
          },
          select: { count: true },
        }),
        tx.messageLog.count({
          where: {
            barbershopId: t.barbershopId,
            channel: 'whatsapp',
            status: { in: ['queued', 'sending'] },
          },
        }),
      ]),
    );
    return { period, whatsapp: { used: used?.count ?? 0, limit: limits.whatsappPerMonth, queued } };
  }

  private view(
    row: {
      provider: 'platform' | 'cloud_api' | 'twilio' | 'wa_me';
      status: 'unverified' | 'ok' | 'error';
      displayPhone: string | null;
      verifiedAt: Date | null;
      lastError: string | null;
      credentialsEnc: Uint8Array | null;
      keyVersion: number;
    } | null,
  ) {
    if (!row)
      return {
        provider: 'platform' as const,
        status: 'unverified' as const,
        displayPhone: null,
        verifiedAt: null,
        lastError: null,
        hasCredentials: false,
        publicFields: {},
      };
    let publicFields: Record<string, string> = {};
    if (row.credentialsEnc && (row.provider === 'cloud_api' || row.provider === 'twilio')) {
      const c = this.crypto.decryptJson<CloudApiCredentials | TwilioCredentials>(
        row.credentialsEnc,
        row.keyVersion,
      );
      publicFields =
        'phoneNumberId' in c
          ? { phoneNumberId: c.phoneNumberId, wabaId: c.wabaId }
          : { accountSid: c.accountSid, fromNumber: c.fromNumber };
    }
    return {
      provider: row.provider,
      status: row.status,
      displayPhone: row.displayPhone,
      verifiedAt: row.verifiedAt,
      lastError: row.lastError,
      hasCredentials: Boolean(row.credentialsEnc),
      publicFields,
    };
  }
}

async function findLog(tx: Tx, barbershopId: string, id: string) {
  const l = await tx.messageLog.findFirst({
    where: { id, barbershopId },
    select: { status: true },
  });
  if (!l) throw AppError.notFound('Mensaje');
  return l;
}
