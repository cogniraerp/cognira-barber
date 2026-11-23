import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { platformDb } from '../../common/auth/platform-db';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DunningService } from './dunning.service';
import { suspendsAt } from './rules';

const DAY = 86_400_000;

/** Tablero de cobranza del superadmin: lo por cobrar, lo vencido, lo cobrado y los avisos. */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dunning: DunningService,
  ) {}

  async overview(u: AuthUser, now = new Date()) {
    const cfg = this.dunning.config;
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.prisma.run(platformDb(u), async (tx) => {
      const [open, paid, subs, suspended, notices] = await Promise.all([
        tx.invoice.findMany({
          where: {
            status: { in: ['open', 'failed'] },
            deletedAt: null,
            amountCents: { gt: 0 },
            barbershop: { deletedAt: null },
          },
          select: {
            id: true,
            amountCents: true,
            dueAt: true,
            barbershop: {
              select: { id: true, name: true, slug: true, status: true, suspendedReason: true },
            },
            subscription: { select: { status: true, plan: { select: { name: true } } } },
            // Varios: correo y WhatsApp se crean juntos (misma hora); con take 1 salía uno al azar.
            notices: {
              select: { kind: true, status: true, createdAt: true, sentAt: true },
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              take: 6,
            },
          },
          orderBy: { dueAt: 'asc' },
        }),
        tx.invoice.aggregate({
          where: { status: 'paid', paidAt: { gte: monthStart } },
          _sum: { amountCents: true },
          _count: true,
        }),
        tx.subscription.findMany({
          where: {
            status: { in: ['active', 'past_due'] },
            deletedAt: null,
            barbershop: { deletedAt: null },
          },
          select: {
            interval: true,
            discountPercent: true,
            plan: { select: { priceMonthlyCents: true, priceYearlyCents: true } },
          },
        }),
        tx.barbershop.count({
          where: { status: 'suspended', suspendedReason: 'billing', deletedAt: null },
        }),
        tx.billingNotice.findMany({
          select: {
            id: true,
            kind: true,
            channel: true,
            status: true,
            recipients: true,
            error: true,
            createdAt: true,
            sentAt: true,
            barbershop: { select: { id: true, name: true } },
            invoice: { select: { number: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);

      const overdue = open.filter((i) => i.dueAt <= now);
      const dueSoon = open.filter((i) => i.dueAt > now);
      const byShop = new Map<string, (typeof overdue)[number][]>();
      for (const i of overdue)
        byShop.set(i.barbershop.id, [...(byShop.get(i.barbershop.id) ?? []), i]);
      const delinquent = [...byShop.values()].map((list) => {
        const oldest = list[0]!;
        // Un aviso omitido (canal desactivado) no cuenta como "último aviso" si otro sí salió.
        const at = (n: { createdAt: Date; sentAt: Date | null }) =>
          (n.sentAt ?? n.createdAt).getTime();
        const notices = list.flatMap((i) => i.notices).sort((a, b) => at(b) - at(a));
        const last = notices.find((n) => n.status !== 'skipped') ?? notices[0];
        return {
          barbershop: oldest.barbershop,
          plan: oldest.subscription.plan.name,
          subscriptionStatus: oldest.subscription.status,
          invoices: list.length,
          owedCents: list.reduce((n, i) => n + i.amountCents, 0),
          oldestDueAt: oldest.dueAt,
          daysOverdue: Math.floor((now.getTime() - oldest.dueAt.getTime()) / DAY),
          suspendsAt: suspendsAt(oldest.dueAt, cfg),
          lastNotice: last
            ? { kind: last.kind, status: last.status, at: last.sentAt ?? last.createdAt }
            : null,
        };
      });
      const sum = (l: { amountCents: number }[]) => l.reduce((n, i) => n + i.amountCents, 0);
      return {
        config: cfg,
        kpis: {
          mrrCents: Math.round(
            subs.reduce((n, s) => {
              const list =
                s.interval === 'year' ? s.plan.priceYearlyCents / 12 : s.plan.priceMonthlyCents;
              return n + (list * (100 - s.discountPercent)) / 100;
            }, 0),
          ),
          activeSubscriptions: subs.length,
          dueSoonCents: sum(dueSoon),
          dueSoonCount: dueSoon.length,
          overdueCents: sum(overdue),
          overdueCount: overdue.length,
          suspendedForBilling: suspended,
          collectedMonthCents: paid._sum.amountCents ?? 0,
          collectedMonthCount: paid._count,
        },
        delinquent: delinquent.sort((a, b) => b.daysOverdue - a.daysOverdue),
        notices: notices.map(({ invoice, ...n }) => ({
          ...n,
          channel: n.channel as 'email' | 'whatsapp',
          invoiceNumber: invoice.number,
        })),
      };
    });
  }
}
