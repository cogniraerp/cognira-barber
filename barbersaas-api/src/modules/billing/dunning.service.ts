import { queueBillingNotice } from './notice-queue';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { addMonths, addYears } from 'date-fns';
import { AuditService } from '../../common/audit/audit.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SenderRegistry } from '../notifications/sender-registry';
import { invoiceNumber } from '../platform/billing/platform-billing.service';
import { normalizePhone } from '../appointments/phone';
import { noticeEmail, noticeWhatsApp } from './notices';
import { invoiceStage, periodAmount, renewalDue, suspendsAt, type DunningConfig } from './rules';

const SYSTEM: DbContext = { kind: 'system' };
const MAX_NOTICE_ATTEMPTS = 5;

export interface DunningResult {
  invoicesIssued: number;
  pastDue: number;
  suspended: number;
  noticesQueued: number;
  noticesSent: number;
  noticesFailed: number;
}

/**
 * Cobranza de suscripciones. Idempotente y seguro con varios workers:
 *  1. Renovación: emite la factura del siguiente periodo (fin de periodo o de prueba a N días).
 *  2. Facturas abiertas: recordatorio, morosidad, último aviso y suspensión por cobranza.
 *  3. Envía los avisos pendientes por correo (la tabla billing_notices deduplica y hace de cola).
 * La reactivación ocurre al liquidar la factura (settleInvoice), por cualquier vía de pago.
 */
@Injectable()
export class DunningService {
  private readonly logger = new Logger('Dunning');
  readonly config: DunningConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly senders: SenderRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.config = {
      renewalLeadDays: env.BILLING_RENEWAL_LEAD_DAYS,
      reminderDays: env.BILLING_REMINDER_DAYS,
      graceDays: env.BILLING_GRACE_DAYS,
    };
  }

  async run(now = new Date()): Promise<DunningResult> {
    const r: DunningResult = {
      invoicesIssued: 0,
      pastDue: 0,
      suspended: 0,
      noticesQueued: 0,
      noticesSent: 0,
      noticesFailed: 0,
    };
    await this.applyScheduledChanges(now);
    await this.renewals(now, r);
    await this.openInvoices(now, r);
    const sent = await this.sendPending();
    r.noticesSent = sent.sent;
    r.noticesFailed = sent.failed;
    if (r.invoicesIssued || r.pastDue || r.suspended || r.noticesSent || r.noticesFailed)
      this.logger.log(`cobranza: ${JSON.stringify(r)}`);
    return r;
  }

  /** Aplica los cambios de plan/intervalo programados cuya fecha ya llegó (fin del periodo). */
  async applyScheduledChanges(now = new Date()): Promise<number> {
    const due = await this.prisma.run(SYSTEM, (tx) =>
      tx.subscription.findMany({
        where: { pendingEffectiveAt: { lte: now }, deletedAt: null },
        select: {
          id: true,
          barbershopId: true,
          planId: true,
          interval: true,
          pendingPlanId: true,
          pendingInterval: true,
        },
      }),
    );
    for (const s of due) {
      await this.prisma.run(SYSTEM, async (tx) => {
        await tx.subscription.update({
          where: { id: s.id },
          data: {
            planId: s.pendingPlanId ?? s.planId,
            interval: s.pendingInterval ?? s.interval,
            pendingPlanId: null,
            pendingInterval: null,
            pendingEffectiveAt: null,
          },
        });
        await this.audit.record(tx, {
          action: 'billing.subscription.scheduled_change_applied',
          barbershopId: s.barbershopId,
          entity: 'subscription',
          entityId: s.id,
          diff: { planId: s.pendingPlanId, interval: s.pendingInterval },
        });
      });
    }
    return due.length;
  }

  private async renewals(now: Date, r: DunningResult) {
    const subs = await this.prisma.run(SYSTEM, (tx) =>
      tx.subscription.findMany({
        where: {
          deletedAt: null,
          status: { in: ['trialing', 'active', 'past_due'] },
          barbershop: { deletedAt: null, status: { not: 'deleted' } },
        },
        select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
      }),
    );
    for (const s of subs) {
      const anchor = s.status === 'trialing' ? s.trialEndsAt : s.currentPeriodEnd;
      if (!anchor || !renewalDue(anchor, now, this.config)) continue;
      await this.prisma.run(SYSTEM, async (tx) => {
        // Un worker a la vez por suscripción; si otro la tiene, se salta.
        const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM subscriptions WHERE id = ${s.id}::uuid FOR UPDATE SKIP LOCKED`;
        if (!locked) return;
        const sub = await tx.subscription.findUniqueOrThrow({
          where: { id: s.id },
          select: {
            barbershopId: true,
            status: true,
            interval: true,
            discountPercent: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            plan: { select: { priceMonthlyCents: true, priceYearlyCents: true, currency: true } },
            pendingPlan: {
              select: { priceMonthlyCents: true, priceYearlyCents: true, currency: true },
            },
            pendingInterval: true,
            pendingEffectiveAt: true,
          },
        });
        const start = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd;
        if (!start) return;
        // ¿Ya hay una factura (no anulada) que cubre el siguiente periodo?
        const exists = await tx.invoice.count({
          where: {
            subscriptionId: s.id,
            deletedAt: null,
            status: { not: 'void' },
            // Margen de 1 día: tolera diferencias de precisión (µs en la BD, ms en JS) y una factura
            // que termina justo en el fin del periodo (p. ej. la diferencia por subir de plan).
            periodEnd: { gt: new Date(start.getTime() + 86_400_000) },
          },
        });
        if (exists) return;
        // Si hay un cambio programado que rige desde ese periodo, la renovación sale con el plan nuevo.
        const pending = !!sub.pendingEffectiveAt && sub.pendingEffectiveAt <= start;
        const plan = (pending && sub.pendingPlan) || sub.plan;
        const interval = (pending && sub.pendingInterval) || sub.interval;
        const amountCents = periodAmount(interval, plan, sub.discountPercent);
        if (amountCents <= 0) return;
        const inv = await tx.invoice.create({
          data: {
            barbershopId: sub.barbershopId,
            subscriptionId: s.id,
            number: invoiceNumber(now),
            amountCents,
            currency: plan.currency,
            status: 'open',
            periodStart: start,
            periodEnd: interval === 'year' ? addYears(start, 1) : addMonths(start, 1),
            dueAt: start > now ? start : now,
            notes: 'Renovación automática',
          },
          select: { id: true, number: true },
        });
        await this.audit.record(tx, {
          action: 'billing.invoice.renewal',
          barbershopId: sub.barbershopId,
          entity: 'invoice',
          entityId: inv.id,
          diff: { number: inv.number, amountCents },
        });
        await queueBillingNotice(tx, {
          barbershopId: sub.barbershopId,
          invoiceId: inv.id,
          kind: 'invoice_issued',
        });
        r.invoicesIssued++;
        r.noticesQueued++;
      });
    }
  }

  private async openInvoices(now: Date, r: DunningResult) {
    const invoices = await this.prisma.run(SYSTEM, (tx) =>
      tx.invoice.findMany({
        where: {
          status: { in: ['open', 'failed'] },
          deletedAt: null,
          amountCents: { gt: 0 },
          barbershop: { deletedAt: null, status: { not: 'deleted' } },
        },
        select: { id: true, dueAt: true },
        orderBy: { dueAt: 'asc' },
      }),
    );
    for (const i of invoices) {
      const stage = invoiceStage(i.dueAt, now, this.config);
      if (!stage.notice && !stage.pastDue) continue;
      await this.prisma.run(SYSTEM, async (tx) => {
        const [locked] = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM invoices WHERE id = ${i.id}::uuid FOR UPDATE SKIP LOCKED`;
        if (!locked || (locked.status !== 'open' && locked.status !== 'failed')) return;
        const inv = await tx.invoice.findUniqueOrThrow({
          where: { id: i.id },
          select: {
            barbershopId: true,
            subscription: { select: { id: true, status: true } },
            barbershop: { select: { status: true } },
          },
        });
        const sub = inv.subscription;
        if (stage.pastDue && (sub.status === 'active' || sub.status === 'trialing')) {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'past_due' } });
          await this.audit.record(tx, {
            action: 'billing.subscription.past_due',
            barbershopId: inv.barbershopId,
            entity: 'subscription',
            entityId: sub.id,
            diff: { invoiceId: i.id },
          });
          r.pastDue++;
        }
        if (stage.suspend && sub.status !== 'suspended' && sub.status !== 'canceled') {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'suspended' } });
          // Una suspensión manual previa se respeta (no se pisa su motivo).
          if (inv.barbershop.status !== 'suspended')
            await tx.barbershop.update({
              where: { id: inv.barbershopId },
              data: { status: 'suspended', suspendedAt: now, suspendedReason: 'billing' },
            });
          await this.audit.record(tx, {
            action: 'billing.barbershop.suspended',
            barbershopId: inv.barbershopId,
            entity: 'barbershop',
            entityId: inv.barbershopId,
            diff: { invoiceId: i.id },
          });
          r.suspended++;
        }
        if (stage.notice) {
          const created = await queueBillingNotice(tx, {
            barbershopId: inv.barbershopId,
            invoiceId: i.id,
            kind: stage.notice,
          });
          r.noticesQueued += created;
        }
      });
    }
  }

  /** Envía los avisos pendientes (reintenta en la siguiente vuelta si falla). */
  /**
   * Envía los avisos pendientes en lotes de 50 hasta vaciar la cola (tope de seguridad: 1000 por
   * llamada). Cada aviso se intenta una sola vez por llamada; los que fallan esperan a la siguiente.
   */
  async sendPending(maxTotal = 1000): Promise<{ sent: number; failed: number }> {
    const out = { sent: 0, failed: 0 };
    const seen: string[] = [];
    while (seen.length < maxTotal) {
      const batch = await this.prisma.run(SYSTEM, (tx) =>
        tx.billingNotice.findMany({
          where: {
            status: 'pending',
            attempts: { lt: MAX_NOTICE_ATTEMPTS },
            ...(seen.length ? { id: { notIn: seen } } : {}),
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 50,
        }),
      );
      if (!batch.length) break;
      seen.push(...batch.map((b) => b.id));
      const r = await this.sendBatch(batch);
      out.sent += r.sent;
      out.failed += r.failed;
    }
    return out;
  }

  private async sendBatch(
    pending: Array<{ id: string }>,
  ): Promise<{ sent: number; failed: number }> {
    const out = { sent: 0, failed: 0 };
    for (const { id } of pending) {
      const claimed = await this.prisma.run(SYSTEM, async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM billing_notices WHERE id = ${id}::uuid AND status = 'pending' FOR UPDATE SKIP LOCKED`;
        if (!row) return null;
        await tx.billingNotice.update({ where: { id }, data: { attempts: { increment: 1 } } });
        return tx.billingNotice.findUniqueOrThrow({
          where: { id },
          select: {
            kind: true,
            channel: true,
            attempts: true,
            barbershop: {
              select: {
                name: true,
                slug: true,
                email: true,
                phone: true,
                country: true,
                timezone: true,
                memberships: {
                  where: { role: 'owner', status: 'active', deletedAt: null },
                  select: { user: { select: { email: true, fullName: true, phone: true } } },
                },
              },
            },
            invoice: {
              select: {
                number: true,
                amountCents: true,
                currency: true,
                periodStart: true,
                periodEnd: true,
                dueAt: true,
              },
            },
          },
        });
      });
      if (!claimed) continue;
      const b = claimed.barbershop;
      const owners = b.memberships
        .map((m) => m.user)
        .filter((u): u is { email: string; fullName: string; phone: string | null } => !!u?.email);
      const fmt = (d: Date) =>
        new Intl.DateTimeFormat('es-PE', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: b.timezone,
        }).format(d);
      const ctx = {
        barbershop: b.name,
        ownerName: owners[0]?.fullName ?? null,
        invoiceNumber: claimed.invoice.number,
        amount: new Intl.NumberFormat('es-PE', {
          style: 'currency',
          currency: claimed.invoice.currency,
        }).format(claimed.invoice.amountCents / 100),
        period: `${fmt(claimed.invoice.periodStart)} – ${fmt(claimed.invoice.periodEnd)}`,
        dueAt: fmt(claimed.invoice.dueAt),
        suspendsAt: fmt(suspendsAt(claimed.invoice.dueAt, this.config)),
        payUrl: `${this.env.WEB_URL}/s/${b.slug}/configuracion/suscripcion`,
      };
      let recipients: string[];
      let error: string | null = null;
      let skip: string | null = null;
      if (claimed.channel === 'whatsapp') {
        // Teléfonos de los dueños; si ninguno tiene, el de la barbería.
        const phones = owners.map((u) => u.phone).filter((p): p is string => !!p);
        recipients = [
          ...new Set(
            (phones.length ? phones : b.phone ? [b.phone] : [])
              .map((p) => normalizePhone(p, b.country ?? 'PE'))
              .filter((p): p is string => !!p),
          ),
        ];
        if (!this.env.BILLING_WHATSAPP_ENABLED) skip = 'WhatsApp de cobranza desactivado';
        else if (!recipients.length) skip = 'Sin teléfono del dueño ni de la barbería';
        else {
          try {
            const sender = this.senders.platform();
            const msg = noticeWhatsApp(claimed.kind, ctx);
            for (const to of recipients)
              await sender.send({ to, body: msg.body, template: msg.template });
          } catch (e) {
            error = (e as Error).message;
          }
        }
      } else {
        recipients = owners.length ? owners.map((u) => u.email) : b.email ? [b.email] : [];
        if (!recipients.length) error = 'La barbería no tiene correo de dueño ni de contacto';
        else {
          try {
            const sender = this.senders.email();
            const mail = noticeEmail(claimed.kind, ctx);
            for (const to of recipients)
              await sender.send({ to, subject: mail.subject, body: mail.body });
          } catch (e) {
            error = (e as Error).message;
          }
        }
      }
      if (skip) {
        await this.prisma.run(SYSTEM, (tx) =>
          tx.billingNotice.update({
            where: { id },
            data: { status: 'skipped', recipients, error: skip },
          }),
        );
        continue;
      }
      const final = !error
        ? 'sent'
        : claimed.attempts >= MAX_NOTICE_ATTEMPTS || !recipients.length
          ? 'failed'
          : 'pending';
      await this.prisma.run(SYSTEM, (tx) =>
        tx.billingNotice.update({
          where: { id },
          data: {
            status: final,
            recipients,
            error,
            ...(final === 'sent' ? { sentAt: new Date() } : {}),
          },
        }),
      );
      if (final === 'sent') out.sent++;
      else if (final === 'failed') out.failed++;
    }
    return out;
  }
}
