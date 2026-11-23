import { Inject, Injectable, Logger } from '@nestjs/common';
import { ManageTokenService } from '../../common/crypto/manage-token';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { MessageChannel, MessageEvent } from '../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { readPreferences } from '../shop/settings.schemas';
import { ProviderError, type OutgoingMessage } from './providers/types';
import { SenderRegistry } from './sender-registry';
import { DEFAULT_TEMPLATES, render, variablesInOrder, type TemplateVars } from './templates';

export const MAX_ATTEMPTS = 5;
/** Reintentos: 1 min, 5 min, 15 min, 1 h. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const STALE_LOCK_MS = 5 * 60_000;

export interface BatchResult {
  claimed: number;
  sent: number;
  manual: number;
  retried: number;
  failed: number;
}

/**
 * Worker de mensajes: la tabla message_logs ES la cola.
 *  1. Recupera mensajes "sending" de un worker que murió (lock vencido).
 *  2. Reclama un lote vencido con FOR UPDATE SKIP LOCKED (varios workers no se pisan).
 *  3. Envía fuera de la transacción (la red no debe retener locks) y registra el resultado.
 */
@Injectable()
export class DispatcherService {
  private readonly logger = new Logger('Dispatcher');

  constructor(
    private readonly prisma: PrismaService,
    private readonly senders: SenderRegistry,
    private readonly tokens: ManageTokenService,
    private readonly plans: PlanLimitsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async processBatch(limit = 20, now = new Date()): Promise<BatchResult> {
    const ids = await this.prisma.run({ kind: 'system' }, async (tx) => {
      await tx.messageLog.updateMany({
        where: { status: 'sending', lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
        data: { status: 'queued', lockedAt: null },
      });
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM message_logs
        WHERE status = 'queued' AND (scheduled_for IS NULL OR scheduled_for <= ${now})
        ORDER BY scheduled_for ASC NULLS FIRST, created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length) {
        await tx.messageLog.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { status: 'sending', lockedAt: now, attempts: { increment: 1 } },
        });
      }
      return rows.map((r) => r.id);
    });

    const result: BatchResult = { claimed: ids.length, sent: 0, manual: 0, retried: 0, failed: 0 };
    for (const id of ids) result[await this.deliver(id, now)]++;
    return result;
  }

  private async deliver(id: string, now: Date): Promise<'sent' | 'manual' | 'retried' | 'failed'> {
    const log = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.messageLog.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          barbershopId: true,
          appointmentId: true,
          event: true,
          channel: true,
          to: true,
          attempts: true,
        },
      }),
    );
    try {
      const prepared = await this.prisma.run(
        { kind: 'system', barbershopId: log.barbershopId },
        (tx) => this.prepare(tx, log, now),
      );
      if ('skip' in prepared) {
        await this.finish(id, { status: 'failed', error: prepared.skip });
        return 'failed';
      }
      const r = await prepared.sender.send(prepared.message);
      await this.prisma.run({ kind: 'system', barbershopId: log.barbershopId }, async (tx) => {
        await tx.messageLog.update({
          where: { id },
          data: {
            status: r.status,
            providerMessageId: r.providerMessageId,
            actionUrl: r.actionUrl ?? null,
            provider: prepared.sender.name,
            body: prepared.message.body,
            sentAt: r.status === 'sent' ? new Date() : null,
            lockedAt: null,
            error: null,
          },
        });
        if (log.channel === 'whatsapp' && r.status === 'sent')
          await this.plans
            .consume(tx, log.barbershopId, 'whatsappPerMonth', 1, now)
            .catch(() => undefined);
      });
      return r.status;
    } catch (e) {
      const retryable = !(e instanceof ProviderError) || e.retryable;
      const message = (e as Error).message.slice(0, 500);
      if (retryable && log.attempts < MAX_ATTEMPTS) {
        const delay = BACKOFF_MS[Math.min(log.attempts - 1, BACKOFF_MS.length - 1)]!;
        await this.prisma.run({ kind: 'system' }, (tx) =>
          tx.messageLog.update({
            where: { id },
            data: {
              status: 'queued',
              lockedAt: null,
              error: message,
              scheduledFor: new Date(now.getTime() + delay),
            },
          }),
        );
        return 'retried';
      }
      this.logger.warn(`Mensaje ${id} falló: ${message}`);
      await this.finish(id, { status: 'failed', error: message });
      return 'failed';
    }
  }

  private async finish(id: string, data: { status: 'failed'; error: string }): Promise<void> {
    await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.messageLog.update({ where: { id }, data: { ...data, lockedAt: null } }),
    );
  }

  /** Arma el mensaje con datos frescos de la cita y la plantilla vigente. */
  private async prepare(
    tx: Tx,
    log: {
      barbershopId: string;
      appointmentId: string | null;
      event: MessageEvent;
      channel: MessageChannel;
      to: string;
    },
    now: Date,
  ): Promise<
    { skip: string } | { sender: ReturnType<SenderRegistry['email']>; message: OutgoingMessage }
  > {
    if (!log.appointmentId) return { skip: 'Mensaje sin cita asociada' };
    const a = await tx.appointment.findUnique({
      where: { id: log.appointmentId },
      select: {
        id: true,
        status: true,
        startAt: true,
        totalCents: true,
        currency: true,
        customer: { select: { fullName: true } },
        staff: { select: { displayName: true } },
        location: { select: { name: true, address: true, timezone: true } },
        items: { select: { nameSnapshot: true }, orderBy: { sortOrder: 'asc' } },
        barbershop: {
          select: {
            name: true,
            slug: true,
            timezone: true,
            locale: true,
            branding: true,
            settings: { select: { preferences: true } },
            whatsappConfig: true,
          },
        },
      },
    });
    if (!a) return { skip: 'La cita ya no existe' };
    if (log.event === 'reminder') {
      if (a.status !== 'confirmed')
        return { skip: `Recordatorio descartado: la cita está "${a.status}"` };
      if (a.startAt <= now) return { skip: 'Recordatorio vencido: la cita ya empezó' };
    }

    const shop = a.barbershop;
    const tz = a.location.timezone ?? shop.timezone;
    const prefs = readPreferences(shop.settings?.preferences);
    const locale = shop.locale.startsWith('en') ? 'en-US' : 'es-PE';
    const manage = `${this.env.WEB_URL.replace(/\/$/, '')}/b/${shop.slug}/cita/${this.tokens.sign(a.id)}`;
    const vars: TemplateVars = {
      cliente: a.customer?.fullName.split(' ')[0] ?? '',
      servicio: a.items.map((i) => i.nameSnapshot).join(' + '),
      barbero: a.staff.displayName,
      fecha: new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: tz,
      }).format(a.startAt),
      hora: new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: prefs.timeFormat === '12h',
        timeZone: tz,
      }).format(a.startAt),
      sede: a.location.name,
      direccion: a.location.address ?? '',
      barberia: shop.name,
      link_cancelar: manage,
      link_reprogramar: manage,
      total: new Intl.NumberFormat(locale, { style: 'currency', currency: a.currency }).format(
        a.totalCents / 100,
      ),
    };

    const custom = await tx.messageTemplate.findFirst({
      where: {
        OR: [{ barbershopId: log.barbershopId }, { barbershopId: null }],
        event: log.event,
        channel: log.channel,
        deletedAt: null,
      },
      orderBy: { barbershopId: { sort: 'desc', nulls: 'last' } }, // la de la barbería gana a la global
      select: { subject: true, body: true, providerTemplateName: true, providerStatus: true },
    });
    const def = DEFAULT_TEMPLATES[log.event][log.channel];
    const body = custom?.body ?? def?.body;
    if (!body) return { skip: `Sin plantilla para ${log.event}/${log.channel}` };
    const message: OutgoingMessage = {
      to: log.to,
      body: render(body, vars),
      subject: render(custom?.subject ?? def?.subject ?? '', vars),
    };

    if (log.channel === 'email') return { sender: this.senders.email(), message };

    const { limits } = await this.plans.entitlements(log.barbershopId);
    if (limits.whatsappPerMonth !== null) {
      const used = await tx.usageCounter.findUnique({
        where: {
          barbershopId_period_metric: {
            barbershopId: log.barbershopId,
            period: now.toISOString().slice(0, 7),
            metric: 'whatsappPerMonth',
          },
        },
        select: { count: true },
      });
      if ((used?.count ?? 0) >= limits.whatsappPerMonth)
        return { skip: 'PLAN_LIMIT_REACHED: se alcanzó el límite mensual de WhatsApp del plan' };
    }
    const cfg = shop.whatsappConfig;
    const sender = this.senders.whatsapp(
      cfg
        ? { provider: cfg.provider, credentialsEnc: cfg.credentialsEnc, keyVersion: cfg.keyVersion }
        : null,
    );
    // Cloud API con plantilla aprobada por Meta: se envía como template (permite escribir fuera de la ventana de 24 h).
    if (
      cfg?.provider === 'cloud_api' &&
      custom?.providerTemplateName &&
      custom.providerStatus === 'approved'
    ) {
      message.template = {
        name: custom.providerTemplateName,
        language: locale.startsWith('en') ? 'en' : 'es',
        params: variablesInOrder(body).map((v) => vars[v]),
      };
    }
    return { sender, message };
  }
}
