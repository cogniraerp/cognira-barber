import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { pageArgs } from '../../common/http/zod';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { GatewayAccountsService } from './accounts.service';
import type { RefundsQueryDto } from './payments.dto';
import { GatewayHttpError } from './providers/types';
import { saleCode } from '../shop/sales/sale-code';

export const MAX_REFUND_ATTEMPTS = 5;
/** Reintentos: 1, 5, 15 y 60 minutos. */
const BACKOFF_MIN = [1, 5, 15, 60];

const select = {
  id: true,
  amountCents: true,
  reason: true,
  status: true,
  providerRefundId: true,
  error: true,
  attempts: true,
  createdAt: true,
  completedAt: true,
  charge: { select: { description: true, currency: true, providerPaymentId: true } },
  sale: { select: { number: true } },
} as const satisfies Prisma.PaymentRefundSelect;
type Row = Prisma.PaymentRefundGetPayload<{ select: typeof select }>;

/**
 * Ejecuta las devoluciones pendientes con la pasarela de cada barbería (lo llama el worker cada
 * minuto). Al completarse, el adelanto asociado queda "devuelto".
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounts: GatewayAccountsService,
  ) {}

  async processDue(now = new Date(), limit = 20): Promise<{ succeeded: number; failed: number }> {
    const due = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.paymentRefund.findMany({
        where: { status: 'pending', nextAttemptAt: { lte: now } },
        select: { id: true, barbershopId: true },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      }),
    );
    const out = { succeeded: 0, failed: 0 };
    for (const d of due) {
      const r = await this.processOne(d.barbershopId, d.id);
      if (r === 'succeeded') out.succeeded++;
      if (r === 'failed') out.failed++;
    }
    return out;
  }

  /** Intenta una devolución (reclamándola con SKIP LOCKED para no duplicar entre workers). */
  async processOne(
    barbershopId: string,
    id: string,
  ): Promise<'succeeded' | 'failed' | 'retry' | 'skip'> {
    const db = { kind: 'tenant' as const, barbershopId };
    const claimed = await this.prisma.run(db, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM payment_refunds WHERE id = ${id}::uuid AND status = 'pending' FOR UPDATE SKIP LOCKED`;
      if (!row) return null;
      return tx.paymentRefund.update({
        where: { id },
        data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 10 * 60_000) },
        select: {
          id: true,
          amountCents: true,
          attempts: true,
          depositId: true,
          charge: {
            select: {
              providerPaymentId: true,
              account: { select: { provider: true, credentialsEnc: true, keyVersion: true } },
            },
          },
        },
      });
    });
    if (!claimed) return 'skip';
    let refundId: string | null = null;
    let error: string | null = null;
    try {
      if (!claimed.charge.providerPaymentId)
        throw new GatewayHttpError('El cobro no tiene id de pago en la pasarela');
      const g = this.accounts.gateway(claimed.charge.account.provider);
      refundId = (
        await g.refund(this.accounts.unseal(claimed.charge.account).creds, {
          paymentId: claimed.charge.providerPaymentId,
          amountCents: claimed.amountCents,
          idempotencyKey: `refund-${claimed.id}`,
        })
      ).refundId;
    } catch (e) {
      error = e instanceof GatewayHttpError ? e.message : 'No se pudo conectar con la pasarela';
    }
    return this.prisma.run(db, async (tx) => {
      if (refundId) {
        const now = new Date();
        await tx.paymentRefund.update({
          where: { id },
          data: { status: 'succeeded', providerRefundId: refundId, error: null, completedAt: now },
        });
        if (claimed.depositId)
          await tx.appointmentDeposit.updateMany({
            where: { id: claimed.depositId, status: 'refund_pending' },
            data: { status: 'refunded', resolvedAt: now },
          });
        await this.audit.record(tx, {
          action: 'shop.refund.succeeded',
          barbershopId,
          entity: 'payment_refund',
          entityId: id,
          diff: { refundId },
        });
        return 'succeeded' as const;
      }
      const giveUp = claimed.attempts >= MAX_REFUND_ATTEMPTS;
      await tx.paymentRefund.update({
        where: { id },
        data: {
          status: giveUp ? 'failed' : 'pending',
          error,
          nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[claimed.attempts - 1] ?? 60) * 60_000),
        },
      });
      if (giveUp)
        this.logger.warn(`Devolución ${id} falló tras ${claimed.attempts} intentos: ${error}`);
      return giveUp ? ('failed' as const) : ('retry' as const);
    });
  }

  async list(t: TenantContext, q: RefundsQueryDto) {
    const where: Prisma.PaymentRefundWhereInput = {
      barbershopId: t.barbershopId,
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await this.prisma.run(tenantDb(t), (tx) =>
      Promise.all([
        tx.paymentRefund.findMany({
          where,
          select,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.paymentRefund.count({ where }),
      ]),
    );
    return { items: items.map(view), total, page: q.page, pageSize: q.pageSize };
  }

  /** Reintentar ahora (una pendiente o una que falló: la vuelve a poner en cola y la intenta). */
  async retry(t: TenantContext, id: string) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      const r = await tx.paymentRefund.findFirst({
        where: { id, barbershopId: t.barbershopId },
        select: { status: true },
      });
      if (!r) throw AppError.notFound('Devolución');
      if (r.status === 'succeeded') throw AppError.conflict('Esta devolución ya se hizo');
      await tx.paymentRefund.update({
        where: { id },
        data: { status: 'pending', attempts: 0, nextAttemptAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'shop.refund.retry',
        barbershopId: t.barbershopId,
        entity: 'payment_refund',
        entityId: id,
      });
    });
    await this.processOne(t.barbershopId, id);
    return this.prisma.run(tenantDb(t), async (tx) =>
      view(await tx.paymentRefund.findUniqueOrThrow({ where: { id }, select })),
    );
  }
}

function view(r: Row) {
  return {
    id: r.id,
    amountCents: r.amountCents,
    currency: r.charge.currency,
    reason: r.reason,
    status: r.status,
    description: r.charge.description,
    providerPaymentId: r.charge.providerPaymentId,
    providerRefundId: r.providerRefundId,
    error: r.error,
    attempts: r.attempts,
    saleCode: r.sale ? saleCode(r.sale.number) : null,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  };
}
