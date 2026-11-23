import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { settleInvoice } from '../platform/billing/platform-billing.service';
import { GatewayAccountsService } from './accounts.service';
import { hashToken, simulatorSig } from './gateway-crypto';
import { PlatformGatewayService } from './platform-gateway.service';
import {
  GatewayHttpError,
  InvalidSignatureError,
  type ProviderStatus,
  type WebhookHint,
  type WebhookInput,
} from './providers/types';

const SYSTEM: DbContext = { kind: 'system' };
/** Un link de pago de factura vive 24 h (el dueño puede pagar más tarde desde el correo o el panel). */
const INVOICE_CHARGE_TTL_MIN = 24 * 60;

const chargeSelect = {
  id: true,
  barbershopId: true,
  invoiceId: true,
  amountCents: true,
  currency: true,
  status: true,
  providerRef: true,
  providerPaymentId: true,
  checkoutUrl: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
  gateway: { select: { id: true, provider: true, credentialsEnc: true, keyVersion: true } },
} as const satisfies Prisma.InvoiceChargeSelect;
type ChargeRow = Prisma.InvoiceChargeGetPayload<{ select: typeof chargeSelect }>;

/**
 * La barbería paga su suscripción en línea con la pasarela de la plataforma. El pago confirmado
 * (webhook o "verificar") liquida la factura: suscripción activa y periodo extendido.
 */
@Injectable()
export class InvoicePayService {
  private readonly logger = new Logger('InvoicePay');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: GatewayAccountsService,
    private readonly platform: PlatformGatewayService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Mi plan: suscripción, facturas y si se puede pagar en línea. */
  async billing(t: TenantContext) {
    const [sub, invoices, active] = await Promise.all([
      this.prisma.run(tenantDb(t), (tx) =>
        tx.subscription.findFirst({
          where: { barbershopId: t.barbershopId, deletedAt: null },
          select: {
            status: true,
            interval: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            discountPercent: true,
            plan: {
              select: {
                code: true,
                name: true,
                priceMonthlyCents: true,
                priceYearlyCents: true,
                currency: true,
              },
            },
          },
        }),
      ),
      this.prisma.run(tenantDb(t), (tx) =>
        tx.invoice.findMany({
          where: { barbershopId: t.barbershopId, deletedAt: null, status: { not: 'draft' } },
          select: {
            id: true,
            number: true,
            status: true,
            amountCents: true,
            currency: true,
            periodStart: true,
            periodEnd: true,
            dueAt: true,
            paidAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 24,
        }),
      ),
      this.prisma.run(SYSTEM, (tx) =>
        tx.platformGateway.count({ where: { deletedAt: null, isActive: true } }),
      ),
    ]);
    if (!sub) throw AppError.notFound('Suscripción');
    return { subscription: sub, invoices, onlinePay: active > 0 };
  }

  /** Genera (o reutiliza, si sigue vigente) el link de pago de una factura abierta. */
  async pay(t: TenantContext, invoiceId: string) {
    const inv = await this.prisma.run(tenantDb(t), (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true, number: true, status: true, amountCents: true, currency: true },
      }),
    );
    if (!inv) throw AppError.notFound('Factura');
    if (inv.status !== 'open' && inv.status !== 'failed')
      throw AppError.conflict('La factura no está pendiente de pago');
    if (inv.amountCents <= 0) throw AppError.conflict('La factura no tiene monto a pagar');

    const created = await this.prisma.run(SYSTEM, async (tx) => {
      const reuse = await tx.invoiceCharge.findFirst({
        where: {
          invoiceId,
          status: 'pending',
          expiresAt: { gt: new Date(Date.now() + 10 * 60_000) },
          checkoutUrl: { not: null },
        },
        select: chargeSelect,
        orderBy: { createdAt: 'desc' },
      });
      if (reuse) return { row: reuse, reused: true };
      const gw = await tx.platformGateway.findFirst({
        where: { deletedAt: null, isActive: true },
        select: { id: true, status: true },
      });
      if (!gw)
        throw new AppError(
          ErrorCode.CONFLICT,
          HttpStatus.CONFLICT,
          'El pago en línea no está disponible: paga por Yape o transferencia y avísanos',
          {
            noGateway: true,
          },
        );
      const row = await tx.invoiceCharge.create({
        data: {
          barbershopId: t.barbershopId,
          invoiceId,
          gatewayId: gw.id,
          amountCents: inv.amountCents,
          currency: inv.currency,
          expiresAt: new Date(Date.now() + INVOICE_CHARGE_TTL_MIN * 60_000),
          createdByUserId: t.userId,
        },
        select: chargeSelect,
      });
      await this.audit.record(tx, {
        action: 'billing.invoice.pay_online',
        barbershopId: t.barbershopId,
        entity: 'invoice',
        entityId: invoiceId,
        diff: { chargeId: row.id, amountCents: inv.amountCents },
      });
      return { row, reused: false };
    });
    if (created.reused) return view(created.row);

    const row = created.row;
    const g = this.accounts.gateway(row.gateway.provider);
    const sealed = this.platform.unseal(row.gateway);
    try {
      const r = await g.createCharge(sealed.creds, {
        chargeId: row.id,
        amountCents: row.amountCents,
        currency: row.currency,
        description: `Cognira Barber · ${t.name} · Factura ${inv.number}`.slice(0, 120),
        notificationUrl: this.platform.webhookUrl(sealed.webhookToken),
        expiresAt: row.expiresAt,
        backUrl: `${this.env.WEB_URL}/s/${t.slug}/configuracion/suscripcion`,
        simulatorSig: simulatorSig(this.env.ENCRYPTION_KEY, row.id),
      });
      return this.prisma.run(SYSTEM, async (tx) =>
        view(
          await tx.invoiceCharge.update({
            where: { id: row.id },
            data: { providerRef: r.providerRef, checkoutUrl: r.checkoutUrl },
            select: chargeSelect,
          }),
        ),
      );
    } catch (e) {
      const message =
        e instanceof GatewayHttpError ? e.message : 'La pasarela no pudo crear el pago';
      await this.prisma.run(SYSTEM, (tx) =>
        tx.invoiceCharge.update({
          where: { id: row.id },
          data: { status: 'failed', lastEvent: { error: message } },
        }),
      );
      throw new AppError(ErrorCode.GATEWAY_ERROR, HttpStatus.BAD_GATEWAY, message);
    }
  }

  async get(t: TenantContext, id: string) {
    const row = await this.prisma.run(SYSTEM, (tx) =>
      // La pasarela de la plataforma no es visible para la barbería: se lee como sistema, filtrando por barbería.
      tx.invoiceCharge.findFirst({
        where: { id, barbershopId: t.barbershopId },
        select: chargeSelect,
      }),
    );
    if (!row) throw AppError.notFound('Pago');
    return view(row);
  }

  /** Pregunta a la pasarela ahora (útil en local, donde los webhooks no llegan). */
  async refresh(t: TenantContext, id: string) {
    const row = await this.prisma.run(SYSTEM, (tx) =>
      // La pasarela de la plataforma no es visible para la barbería: se lee como sistema, filtrando por barbería.
      tx.invoiceCharge.findFirst({
        where: { id, barbershopId: t.barbershopId },
        select: chargeSelect,
      }),
    );
    if (!row) throw AppError.notFound('Pago');
    if (row.status === 'pending' || row.status === 'expired') {
      let st: ProviderStatus;
      try {
        st = await this.accounts
          .gateway(row.gateway.provider)
          .fetchStatus(this.platform.unseal(row.gateway).creds, row);
      } catch (e) {
        throw new AppError(
          ErrorCode.GATEWAY_ERROR,
          HttpStatus.BAD_GATEWAY,
          e instanceof GatewayHttpError ? e.message : 'No se pudo consultar la pasarela',
        );
      }
      await this.apply(id, st, 'refresh');
    }
    return this.get(t, id);
  }

  /** Webhook de la pasarela de la plataforma. Misma regla: el estado se pregunta a la API. */
  async webhook(token: string, input: WebhookInput): Promise<void> {
    const gw = await this.prisma.run(SYSTEM, (tx) =>
      tx.platformGateway.findUnique({
        where: { webhookTokenHash: hashToken(token) },
        select: {
          id: true,
          provider: true,
          credentialsEnc: true,
          keyVersion: true,
          deletedAt: true,
        },
      }),
    );
    if (!gw || gw.deletedAt) return;
    const g = this.accounts.gateway(gw.provider);
    const { creds } = this.platform.unseal(gw);
    let hint: WebhookHint | null;
    try {
      hint = g.parseWebhook(creds, input);
    } catch (e) {
      if (e instanceof InvalidSignatureError) throw AppError.unauthenticated(e.message);
      throw e;
    }
    if (!hint) return;
    const chargeId = await g.resolveChargeId(creds, hint);
    if (!chargeId || !/^[0-9a-f-]{36}$/i.test(chargeId)) return;
    const charge = await this.prisma.run(SYSTEM, (tx) =>
      tx.invoiceCharge.findFirst({
        where: { id: chargeId, gatewayId: gw.id },
        select: { id: true, amountCents: true, currency: true, providerRef: true },
      }),
    );
    if (!charge) return;
    await this.apply(charge.id, await g.fetchStatus(creds, charge, hint), 'webhook');
  }

  /** ¿Es un pago de factura? (el checkout simulado atiende ambos tipos de cobro). */
  async owns(id: string): Promise<boolean> {
    return !!(await this.prisma.run(SYSTEM, (tx) =>
      tx.invoiceCharge.findUnique({ where: { id }, select: { id: true } }),
    ));
  }

  simulatorPage(id: string) {
    return this.prisma.run(SYSTEM, async (tx) => {
      const row = await tx.invoiceCharge.findUnique({
        where: { id },
        select: {
          amountCents: true,
          currency: true,
          status: true,
          expiresAt: true,
          invoice: { select: { number: true } },
          barbershop: { select: { name: true } },
        },
      });
      if (!row) throw AppError.notFound('Pago');
      return {
        amountCents: row.amountCents,
        currency: row.currency,
        description: `Suscripción Cognira Barber · Factura ${row.invoice.number}`,
        status: row.status,
        expiresAt: row.expiresAt,
        barbershop: { name: 'Cognira Barber' },
      };
    });
  }

  async simulatorPay(id: string, approve: boolean) {
    const st: ProviderStatus = approve
      ? {
          status: 'paid',
          paymentId: `sim_${randomBytes(6).toString('hex')}`,
          detail: { status: 'approved' },
        }
      : { status: 'pending', paymentId: null, detail: { status: 'rejected' } };
    await this.apply(id, st, 'simulator');
    return this.simulatorPage(id);
  }

  /**
   * Aplica lo que dijo la pasarela y, si se pagó, liquida la factura en la misma transacción.
   * Si la factura ya estaba pagada (p. ej. a mano), el pago queda registrado para devolverlo.
   */
  private apply(id: string, st: ProviderStatus, source: string) {
    return this.prisma.run(SYSTEM, async (tx: Tx) => {
      const [row] = await tx.$queryRaw<Array<{ status: string; invoice_id: string }>>`
        SELECT status, invoice_id FROM invoice_charges WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw AppError.notFound('Pago');
      const lastEvent = {
        source,
        at: new Date().toISOString(),
        ...(st.detail ?? {}),
      } as Prisma.InputJsonObject;
      if (row.status === 'paid' || st.status !== 'paid') {
        await tx.invoiceCharge.update({ where: { id }, data: { lastEvent } });
        return;
      }
      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id: row.invoice_id },
        select: { status: true },
      });
      const duplicate = inv.status === 'paid' || inv.status === 'void';
      await tx.invoiceCharge.update({
        where: { id },
        data: {
          status: 'paid',
          paidAt: new Date(),
          providerPaymentId: st.paymentId,
          lastEvent: duplicate
            ? { ...lastEvent, warning: `Factura ya ${inv.status}: devolver este pago` }
            : lastEvent,
        },
      });
      if (duplicate) {
        this.logger.warn(
          `Pago ${id} llegó con la factura ${row.invoice_id} ya ${inv.status}: requiere devolución`,
        );
        return;
      }
      await settleInvoice(tx, this.audit, row.invoice_id, {
        paidAt: new Date(),
        gatewayRef: st.paymentId,
        notes: null,
        action: 'billing.invoice.paid_online',
      });
      this.logger.log(`Factura ${row.invoice_id} pagada en línea (${source})`);
    });
  }
}

function view(r: ChargeRow) {
  const expired = r.status === 'pending' && r.expiresAt <= new Date();
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    provider: r.gateway.provider,
    amountCents: r.amountCents,
    currency: r.currency,
    status: expired ? ('expired' as const) : r.status,
    checkoutUrl: r.checkoutUrl,
    providerPaymentId: r.providerPaymentId,
    expiresAt: r.expiresAt,
    paidAt: r.paidAt,
  };
}
