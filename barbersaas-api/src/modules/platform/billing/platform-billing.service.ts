import { queueBillingNotice } from '../../billing/notice-queue';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { addMonths, addYears } from 'date-fns';
import { AuditService } from '../../../common/audit/audit.service';
import type { AuthUser } from '../../../common/auth/auth.types';
import { platformDb } from '../../../common/auth/platform-db';
import { AppError } from '../../../common/errors/app-error';
import { pageArgs } from '../../../common/http/zod';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import type { CreateInvoiceDto, ListInvoicesQueryDto, MarkPaidDto } from './platform-billing.dto';

const invoiceSelect = {
  id: true,
  number: true,
  status: true,
  amountCents: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  dueAt: true,
  paidAt: true,
  gatewayRef: true,
  notes: true,
  createdAt: true,
  barbershop: { select: { id: true, slug: true, name: true } },
} as const satisfies Prisma.InvoiceSelect;

/**
 * Facturación de la suscripción SaaS — Fase 1: adaptador "manual".
 * El superadmin emite la factura y la marca como pagada (Yape, transferencia…).
 * El cobro automático con pasarela y el dunning llegan en la Fase 2 detrás de PaymentGateway.
 */
@Injectable()
export class PlatformBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListInvoicesQueryDto) {
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.barbershopId ? { barbershopId: q.barbershopId } : {}),
    };
    const [items, total] = await this.prisma.run(platformDb(user), (tx) =>
      Promise.all([
        tx.invoice.findMany({
          where,
          select: invoiceSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.invoice.count({ where }),
      ]),
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** Factura el siguiente periodo de la suscripción. */
  create(user: AuthUser, barbershopId: string, dto: CreateInvoiceDto) {
    return this.prisma.run(platformDb(user), async (tx) => {
      const sub = await tx.subscription.findFirst({
        where: { barbershopId, deletedAt: null, barbershop: { deletedAt: null } },
        select: {
          id: true,
          interval: true,
          discountPercent: true,
          currentPeriodEnd: true,
          plan: { select: { priceMonthlyCents: true, priceYearlyCents: true, currency: true } },
        },
      });
      if (!sub) throw AppError.notFound('Suscripción');
      const now = new Date();
      const periodStart =
        sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
      const periodEnd =
        sub.interval === 'year' ? addYears(periodStart, 1) : addMonths(periodStart, 1);
      const list = sub.interval === 'year' ? sub.plan.priceYearlyCents : sub.plan.priceMonthlyCents;
      const amountCents = dto.amountCents ?? Math.round((list * (100 - sub.discountPercent)) / 100);

      const invoice = await tx.invoice.create({
        data: {
          barbershopId,
          subscriptionId: sub.id,
          number: invoiceNumber(now),
          amountCents,
          currency: sub.plan.currency,
          status: 'open',
          periodStart,
          periodEnd,
          dueAt: new Date(now.getTime() + dto.dueInDays * 86_400_000),
          notes: dto.notes,
        },
        select: invoiceSelect,
      });
      await this.audit.record(tx, {
        action: 'platform.invoice.create',
        barbershopId,
        entity: 'invoice',
        entityId: invoice.id,
        diff: { amountCents, number: invoice.number },
      });
      return invoice;
    });
  }

  /** Marca como pagada, activa la suscripción y extiende el periodo hasta el fin de la factura. */
  markPaid(user: AuthUser, id: string, dto: MarkPaidDto) {
    return this.prisma.run(platformDb(user), async (tx) => {
      await settleInvoice(tx, this.audit, id, {
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        gatewayRef: dto.gatewayRef ?? null,
        notes: dto.notes ?? null,
        action: 'platform.invoice.mark_paid',
      });
      return tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect });
    });
  }

  void(user: AuthUser, id: string, reason: string) {
    return this.prisma.run(platformDb(user), async (tx) => {
      const inv = await findInvoice(tx, id);
      if (inv.status === 'paid') throw AppError.conflict('No se puede anular una factura pagada');
      const updated = await tx.invoice.update({
        where: { id },
        data: { status: 'void', notes: reason },
        select: invoiceSelect,
      });
      await this.audit.record(tx, {
        action: 'platform.invoice.void',
        barbershopId: inv.barbershopId,
        entity: 'invoice',
        entityId: id,
        diff: { reason },
      });
      return updated;
    });
  }
}

/**
 * Liquida una factura: pagada, suscripción activa y periodo extendido hasta el fin de la factura.
 * La usan el superadmin (pago manual) y la pasarela de la plataforma (pago en línea).
 * Debe correr en un contexto privilegiado (superadmin o system).
 */
export async function settleInvoice(
  tx: Tx,
  audit: AuditService,
  id: string,
  p: { paidAt: Date; gatewayRef: string | null; notes: string | null; action: string },
): Promise<void> {
  const [row] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
  if (!row) throw AppError.notFound('Factura');
  const inv = await findInvoice(tx, id);
  if (inv.status === 'paid') throw AppError.conflict('La factura ya está pagada');
  if (inv.status === 'void') throw AppError.conflict('La factura está anulada');
  await tx.invoice.update({
    where: { id },
    data: {
      status: 'paid',
      paidAt: p.paidAt,
      gatewayRef: p.gatewayRef,
      notes: p.notes ?? inv.notes,
    },
  });
  const sub = await tx.subscription.findUniqueOrThrow({
    where: { id: inv.subscriptionId },
    select: { currentPeriodEnd: true },
  });
  const currentPeriodEnd =
    !sub.currentPeriodEnd || inv.periodEnd > sub.currentPeriodEnd
      ? inv.periodEnd
      : sub.currentPeriodEnd;
  // ¿Le quedan facturas vencidas? Entonces sigue morosa (y suspendida, si lo estaba).
  const stillOverdue = await tx.invoice.count({
    where: {
      subscriptionId: inv.subscriptionId,
      id: { not: id },
      status: { in: ['open', 'failed'] },
      dueAt: { lte: new Date() },
      deletedAt: null,
    },
  });
  const shop = await tx.barbershop.findUniqueOrThrow({
    where: { id: inv.barbershopId },
    select: { status: true, suspendedReason: true },
  });
  await tx.subscription.update({
    where: { id: inv.subscriptionId },
    data: { status: stillOverdue ? 'past_due' : 'active', trialEndsAt: null, currentPeriodEnd },
  });
  await audit.record(tx, {
    action: p.action,
    barbershopId: inv.barbershopId,
    entity: 'invoice',
    entityId: id,
    diff: { gatewayRef: p.gatewayRef, amountCents: inv.amountCents },
  });
  // Reactivación automática: solo si la suspendió la cobranza (no una suspensión manual).
  if (!stillOverdue && shop.status === 'suspended' && shop.suspendedReason === 'billing') {
    await tx.barbershop.update({
      where: { id: inv.barbershopId },
      data: { status: 'active', suspendedAt: null, suspendedReason: null },
    });
    await queueBillingNotice(tx, {
      barbershopId: inv.barbershopId,
      invoiceId: id,
      kind: 'reactivated',
    });
    await audit.record(tx, {
      action: 'billing.barbershop.reactivated',
      barbershopId: inv.barbershopId,
      entity: 'barbershop',
      entityId: inv.barbershopId,
      diff: { invoiceId: id },
    });
  }
}

async function findInvoice(tx: Tx, id: string) {
  const inv = await tx.invoice.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      status: true,
      barbershopId: true,
      subscriptionId: true,
      periodEnd: true,
      amountCents: true,
      notes: true,
    },
  });
  if (!inv) throw AppError.notFound('Factura');
  return inv;
}

export function invoiceNumber(now: Date): string {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `INV-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`;
}
