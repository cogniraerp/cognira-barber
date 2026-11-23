import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { pageArgs } from '../../common/http/zod';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { onDepositChargePaid } from '../deposits/deposits';
import { NotificationsService } from '../notifications/notifications.service';
import { saleCode } from '../shop/sales/sale-code';
import { GatewayAccountsService } from './accounts.service';
import { checkSimulatorSig, hashToken, simulatorSig } from './gateway-crypto';
import type { ChargesQueryDto, CreateChargeDto } from './payments.dto';
import {
  GatewayHttpError,
  InvalidSignatureError,
  type ProviderStatus,
  type WebhookHint,
  type WebhookInput,
} from './providers/types';

/** Minutos que vive un link de pago. */
export const CHARGE_TTL_MIN = 30;

const chargeSelect = {
  id: true,
  barbershopId: true,
  amountCents: true,
  currency: true,
  description: true,
  status: true,
  providerRef: true,
  checkoutUrl: true,
  providerPaymentId: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
  account: { select: { id: true, provider: true, credentialsEnc: true, keyVersion: true } },
  sale: { select: { id: true, number: true } },
} as const satisfies Prisma.PaymentChargeSelect;
type ChargeRow = Prisma.PaymentChargeGetPayload<{ select: typeof chargeSelect }>;

/**
 * Cobros por link/QR con la pasarela de la barbería. El estado "pagado" solo lo da la pasarela
 * (webhook + consulta a su API, o el checkout del simulador). Un cobro pagado se usa una sola vez
 * como pago "online" de una venta.
 */
@Injectable()
export class ChargesService {
  private readonly logger = new Logger('Charges');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
    private readonly accounts: GatewayAccountsService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(t: TenantContext, dto: CreateChargeDto) {
    await this.plans.assertFeature(t.barbershopId, 'onlinePayments');
    const created = await this.prisma.run(tenantDb(t), async (tx) => {
      const account = await tx.paymentGatewayAccount.findFirst({
        where: { barbershopId: t.barbershopId, deletedAt: null, isActive: true },
        select: { id: true, status: true },
      });
      if (!account)
        throw new AppError(
          ErrorCode.CONFLICT,
          HttpStatus.CONFLICT,
          'Conecta una pasarela de pago en Configuración → Pagos en línea',
          {
            noGateway: true,
          },
        );
      if (account.status === 'error')
        throw AppError.conflict(
          'La pasarela tiene un error de conexión: revísala en Configuración → Pagos en línea',
        );
      const row = await tx.paymentCharge.create({
        data: {
          barbershopId: t.barbershopId,
          accountId: account.id,
          amountCents: dto.amountCents,
          currency: t.currency,
          description: dto.description ?? `${t.name} · Cobro`,
          expiresAt: new Date(Date.now() + CHARGE_TTL_MIN * 60_000),
          createdByUserId: t.userId,
        },
        select: chargeSelect,
      });
      await this.audit.record(tx, {
        action: 'shop.charge.create',
        barbershopId: t.barbershopId,
        entity: 'payment_charge',
        entityId: row.id,
        diff: { amountCents: dto.amountCents },
      });
      return row;
    });

    // La llamada a la pasarela va fuera de la transacción (puede tardar).
    const g = this.accounts.gateway(created.account.provider);
    const sealed = this.accounts.unseal(created.account);
    try {
      const r = await g.createCharge(sealed.creds, {
        chargeId: created.id,
        amountCents: created.amountCents,
        currency: created.currency,
        description: created.description,
        notificationUrl: this.accounts.webhookUrl(sealed.webhookToken),
        expiresAt: created.expiresAt,
        simulatorSig: simulatorSig(this.env.ENCRYPTION_KEY, created.id),
      });
      return this.prisma.run(tenantDb(t), async (tx) =>
        view(
          await tx.paymentCharge.update({
            where: { id: created.id },
            data: { providerRef: r.providerRef, checkoutUrl: r.checkoutUrl },
            select: chargeSelect,
          }),
        ),
      );
    } catch (e) {
      const message =
        e instanceof GatewayHttpError ? e.message : 'La pasarela no pudo crear el cobro';
      await this.prisma.run(tenantDb(t), (tx) =>
        tx.paymentCharge.update({
          where: { id: created.id },
          data: { status: 'failed', lastEvent: { error: message } },
        }),
      );
      throw new AppError(ErrorCode.GATEWAY_ERROR, HttpStatus.BAD_GATEWAY, message);
    }
  }

  get(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      view(await expireIfDue(tx, await find(tx, t.barbershopId, id))),
    );
  }

  /** Consulta a la pasarela ahora (útil en local, donde los webhooks no llegan). */
  async refresh(t: TenantContext, id: string) {
    const row = await this.prisma.run(tenantDb(t), (tx) => find(tx, t.barbershopId, id));
    if (row.status === 'pending' || row.status === 'expired') {
      const g = this.accounts.gateway(row.account.provider);
      let st: ProviderStatus;
      try {
        st = await g.fetchStatus(this.accounts.unseal(row.account).creds, row);
      } catch (e) {
        throw new AppError(
          ErrorCode.GATEWAY_ERROR,
          HttpStatus.BAD_GATEWAY,
          e instanceof GatewayHttpError ? e.message : 'No se pudo consultar la pasarela',
        );
      }
      await this.apply(tenantDb(t), t.barbershopId, id, st, 'refresh');
    }
    return this.get(t, id);
  }

  cancel(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const row = await lock(tx, t.barbershopId, id);
      if (row.status !== 'pending') throw AppError.conflict('Solo se cancela un cobro pendiente');
      await tx.paymentCharge.update({ where: { id }, data: { status: 'canceled' } });
      return view(await find(tx, t.barbershopId, id));
    });
  }

  async list(t: TenantContext, q: ChargesQueryDto) {
    const where: Prisma.PaymentChargeWhereInput = {
      barbershopId: t.barbershopId,
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await this.prisma.run(tenantDb(t), (tx) =>
      Promise.all([
        tx.paymentCharge.findMany({
          where,
          select: chargeSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.paymentCharge.count({ where }),
      ]),
    );
    return { items: items.map(view), total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * Webhook de la pasarela: el token de la URL identifica la cuenta; la firma (si la cuenta la
   * configuró) y luego la consulta a la API de la pasarela deciden. Idempotente.
   */
  async webhook(token: string, input: WebhookInput): Promise<void> {
    const account = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.paymentGatewayAccount.findUnique({
        where: { webhookTokenHash: hashToken(token) },
        select: {
          id: true,
          barbershopId: true,
          provider: true,
          credentialsEnc: true,
          keyVersion: true,
          deletedAt: true,
        },
      }),
    );
    if (!account || account.deletedAt) return;
    const g = this.accounts.gateway(account.provider);
    const { creds } = this.accounts.unseal(account);
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
    const db: DbContext = { kind: 'tenant', barbershopId: account.barbershopId };
    const charge = await this.prisma.run(db, (tx) =>
      tx.paymentCharge.findFirst({
        where: { id: chargeId, barbershopId: account.barbershopId, accountId: account.id },
        select: { id: true, amountCents: true, currency: true, providerRef: true },
      }),
    );
    if (!charge) return;
    const st = await g.fetchStatus(creds, charge, hint);
    await this.apply(db, account.barbershopId, charge.id, st, 'webhook');
  }

  // ───────────────────────── checkout simulado (solo desarrollo) ─────────────────────────

  async simulatorPage(id: string, sig: string) {
    this.assertSimulator(id, sig);
    return this.prisma.run({ kind: 'system' }, async (tx) => {
      const row = await tx.paymentCharge.findUnique({
        where: { id },
        select: {
          amountCents: true,
          currency: true,
          description: true,
          status: true,
          expiresAt: true,
          barbershop: { select: { name: true } },
        },
      });
      if (!row) throw AppError.notFound('Cobro');
      return row;
    });
  }

  async simulatorPay(id: string, sig: string, approve: boolean) {
    this.assertSimulator(id, sig);
    const row = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.paymentCharge.findUnique({
        where: { id },
        select: { barbershopId: true, account: { select: { provider: true } } },
      }),
    );
    if (!row || row.account.provider !== 'simulator') throw AppError.notFound('Cobro');
    const st: ProviderStatus = approve
      ? {
          status: 'paid',
          paymentId: `sim_${randomBytes(6).toString('hex')}`,
          detail: { status: 'approved' },
        }
      : {
          status: 'pending',
          paymentId: null,
          detail: { status: 'rejected', statusDetail: 'cc_rejected_simulated' },
        };
    await this.apply(
      { kind: 'tenant', barbershopId: row.barbershopId },
      row.barbershopId,
      id,
      st,
      'simulator',
    );
    return this.simulatorPage(id, sig);
  }

  assertSimulator(id: string, sig: string) {
    if (
      this.env.NODE_ENV === 'production' ||
      !checkSimulatorSig(this.env.ENCRYPTION_KEY, id, sig ?? '')
    )
      throw AppError.notFound('Cobro');
  }

  /** Aplica lo que dijo la pasarela. Un cobro pagado no retrocede; si pagan tarde, igual cuenta. */
  private apply(
    db: DbContext,
    barbershopId: string,
    id: string,
    st: ProviderStatus,
    source: string,
  ) {
    return this.prisma.run(db, async (tx) => {
      const row = await lock(tx, barbershopId, id);
      const lastEvent = {
        source,
        at: new Date().toISOString(),
        ...(st.detail ?? {}),
      } as Prisma.InputJsonObject;
      if (row.status === 'paid' || st.status !== 'paid') {
        await tx.paymentCharge.update({ where: { id }, data: { lastEvent } });
        return;
      }
      await tx.paymentCharge.update({
        where: { id },
        data: { status: 'paid', paidAt: new Date(), providerPaymentId: st.paymentId, lastEvent },
      });
      await this.audit.record(tx, {
        action: 'shop.charge.paid',
        barbershopId,
        entity: 'payment_charge',
        entityId: id,
        diff: { providerPaymentId: st.paymentId, source },
      });
      // Si es el adelanto de una reserva, la confirma en la misma transacción.
      await onDepositChargePaid(tx, id, { notifications: this.notifications, audit: this.audit });
      this.logger.log(`Cobro ${id} pagado (${source})`);
    });
  }

  // ───────────────────────── adelantos (sin usuario: reserva pública y worker) ─────────────────────────

  /** ¿La barbería puede cobrar adelantos? (plan con pagos en línea y pasarela activa sin error). */
  async depositsEnabled(barbershopId: string): Promise<boolean> {
    const { features } = await this.plans.entitlements(barbershopId);
    if (!features.onlinePayments) return false;
    const n = await this.prisma.run({ kind: 'tenant', barbershopId }, (tx) =>
      tx.paymentGatewayAccount.count({
        where: { barbershopId, deletedAt: null, isActive: true, status: { not: 'error' } },
      }),
    );
    return n > 0;
  }

  /**
   * Cobro del adelanto de una reserva: link de pago que vence con el apartado del horario.
   * Si la pasarela falla, se libera el horario (la cita se cancela) y se informa al cliente.
   */
  async createForDeposit(
    barbershopId: string,
    depositId: string,
    backUrl: string,
  ): Promise<string> {
    const db: DbContext = { kind: 'tenant', barbershopId };
    const created = await this.prisma.run(db, async (tx) => {
      const dep = await tx.appointmentDeposit.findUniqueOrThrow({
        where: { id: depositId },
        select: {
          amountCents: true,
          holdExpiresAt: true,
          appointment: {
            select: {
              startAt: true,
              currency: true,
              items: { select: { nameSnapshot: true }, orderBy: { sortOrder: 'asc' } },
            },
          },
          barbershop: { select: { name: true, timezone: true } },
        },
      });
      const account = await tx.paymentGatewayAccount.findFirst({
        where: { barbershopId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!account) throw AppError.conflict('La barbería no tiene una pasarela activa');
      const when = new Intl.DateTimeFormat('es-PE', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: dep.barbershop.timezone,
      }).format(dep.appointment.startAt);
      const what = dep.appointment.items.map((i) => i.nameSnapshot).join(' + ');
      const row = await tx.paymentCharge.create({
        data: {
          barbershopId,
          accountId: account.id,
          amountCents: dep.amountCents,
          currency: dep.appointment.currency,
          description: `Adelanto · ${what} · ${when} · ${dep.barbershop.name}`.slice(0, 120),
          expiresAt: dep.holdExpiresAt,
        },
        select: chargeSelect,
      });
      await tx.appointmentDeposit.update({ where: { id: depositId }, data: { chargeId: row.id } });
      return row;
    });
    const g = this.accounts.gateway(created.account.provider);
    const sealed = this.accounts.unseal(created.account);
    try {
      const r = await g.createCharge(sealed.creds, {
        chargeId: created.id,
        amountCents: created.amountCents,
        currency: created.currency,
        description: created.description,
        notificationUrl: this.accounts.webhookUrl(sealed.webhookToken),
        expiresAt: created.expiresAt,
        backUrl,
        simulatorSig: simulatorSig(this.env.ENCRYPTION_KEY, created.id),
      });
      await this.prisma.run(db, (tx) =>
        tx.paymentCharge.update({
          where: { id: created.id },
          data: { providerRef: r.providerRef, checkoutUrl: r.checkoutUrl },
        }),
      );
      return r.checkoutUrl;
    } catch (e) {
      const message =
        e instanceof GatewayHttpError ? e.message : 'La pasarela no pudo crear el cobro';
      await this.prisma.run(db, async (tx) => {
        await tx.paymentCharge.update({
          where: { id: created.id },
          data: { status: 'failed', lastEvent: { error: message } },
        });
        await releaseHold(tx, depositId, 'No se pudo iniciar el pago del adelanto');
      });
      throw new AppError(
        ErrorCode.GATEWAY_ERROR,
        HttpStatus.BAD_GATEWAY,
        'No pudimos iniciar el pago. Intenta reservar de nuevo.',
      );
    }
  }

  /** Consulta a la pasarela un cobro (sin usuario): "ya pagué" del cliente y el worker. */
  async refreshSystem(barbershopId: string, id: string): Promise<void> {
    const db: DbContext = { kind: 'tenant', barbershopId };
    const row = await this.prisma.run(db, (tx) => find(tx, barbershopId, id));
    if (row.status !== 'pending' && row.status !== 'expired') return;
    const st = await this.accounts
      .gateway(row.account.provider)
      .fetchStatus(this.accounts.unseal(row.account).creds, row);
    await this.apply(db, barbershopId, id, st, 'refresh');
  }
}

/** Libera el horario apartado: cancela la cita, vence el adelanto y su cobro pendiente. */
export async function releaseHold(tx: Tx, depositId: string, reason: string): Promise<boolean> {
  const dep = await tx.appointmentDeposit.findUniqueOrThrow({
    where: { id: depositId },
    select: {
      status: true,
      chargeId: true,
      appointmentId: true,
      appointment: { select: { status: true } },
    },
  });
  if (dep.status !== 'pending' || dep.appointment.status !== 'awaiting_payment') return false;
  const now = new Date();
  await tx.appointment.update({
    where: { id: dep.appointmentId },
    data: { status: 'canceled', canceledAt: now, cancelReason: reason },
  });
  await tx.appointmentDeposit.update({
    where: { id: depositId },
    data: { status: 'expired', resolvedAt: now },
  });
  if (dep.chargeId)
    await tx.paymentCharge.updateMany({
      where: { id: dep.chargeId, status: 'pending' },
      data: { status: 'canceled' },
    });
  return true;
}

/**
 * Para una venta: bloquea el cobro y comprueba que esté pagado, sin usar y por el monto exacto.
 * Lo llama SalesService dentro de su transacción.
 */
export async function claimCharge(
  tx: Tx,
  barbershopId: string,
  chargeId: string,
  amountCents: number,
) {
  const row = await lock(tx, barbershopId, chargeId);
  if (row.status !== 'paid') throw AppError.conflict('El cobro en línea todavía no está pagado');
  if (row.sale_id) throw AppError.conflict('Ese cobro en línea ya se usó en otra venta');
  if (row.amount_cents !== amountCents)
    throw AppError.conflict('El monto no coincide con el cobro en línea');
  return { providerPaymentId: row.provider_payment_id };
}

async function lock(tx: Tx, barbershopId: string, id: string) {
  const [row] = await tx.$queryRaw<
    Array<{
      status: string;
      sale_id: string | null;
      amount_cents: number;
      provider_payment_id: string | null;
    }>
  >`SELECT status, sale_id, amount_cents, provider_payment_id FROM payment_charges WHERE id = ${id}::uuid AND barbershop_id = ${barbershopId}::uuid FOR UPDATE`;
  if (!row) throw AppError.notFound('Cobro');
  return row;
}

async function find(tx: Tx, barbershopId: string, id: string) {
  const row = await tx.paymentCharge.findFirst({
    where: { id, barbershopId },
    select: chargeSelect,
  });
  if (!row) throw AppError.notFound('Cobro');
  return row;
}

async function expireIfDue(tx: Tx, row: ChargeRow): Promise<ChargeRow> {
  if (row.status !== 'pending' || row.expiresAt > new Date()) return row;
  await tx.paymentCharge.updateMany({
    where: { id: row.id, status: 'pending' },
    data: { status: 'expired' },
  });
  return { ...row, status: 'expired' };
}

function view(r: ChargeRow) {
  return {
    id: r.id,
    provider: r.account.provider,
    amountCents: r.amountCents,
    currency: r.currency,
    description: r.description,
    status: r.status,
    checkoutUrl: r.checkoutUrl,
    providerPaymentId: r.providerPaymentId,
    expiresAt: r.expiresAt,
    paidAt: r.paidAt,
    sale: r.sale ? { id: r.sale.id, code: saleCode(r.sale.number) } : null,
    createdAt: r.createdAt,
  };
}
