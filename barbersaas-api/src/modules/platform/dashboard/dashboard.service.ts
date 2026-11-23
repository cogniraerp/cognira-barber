import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth.types';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import type { PlatformDashboardDto } from './dashboard.dto';

const PLATFORM_TZ = 'America/Lima';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  get(user: AuthUser): Promise<PlatformDashboardDto> {
    return this.prisma.run({ kind: 'superadmin', userId: user.userId }, async (tx) => {
      const now = new Date();
      const d30 = new Date(now.getTime() - 30 * 86_400_000);
      const d90 = new Date(now.getTime() - 90 * 86_400_000);
      const period = now.toISOString().slice(0, 7);

      const [shopStatus, subStatus, mrr, canceled30, trials, signups, appts, wa, top] =
        await Promise.all([
          tx.barbershop.groupBy({ by: ['status'], _count: { _all: true } }),
          tx.subscription.groupBy({
            by: ['status'],
            where: { deletedAt: null },
            _count: { _all: true },
          }),
          tx.$queryRaw<Array<{ currency: string; amount: number }>>`
          SELECT p.currency,
                 COALESCE(SUM(
                   (CASE WHEN s.interval = 'year' THEN p.price_yearly_cents / 12.0 ELSE p.price_monthly_cents END)
                   * (100 - s.discount_percent) / 100.0
                 ), 0)::float8 AS amount
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status = 'active' AND s.deleted_at IS NULL
          GROUP BY p.currency ORDER BY p.currency`,
          tx.subscription.count({ where: { canceledAt: { gte: d30 } } }),
          tx.subscription.groupBy({
            by: ['status'],
            where: { createdAt: { gte: d90 } },
            _count: { _all: true },
          }),
          tx.$queryRaw<Array<{ day: string; count: number }>>`
          SELECT to_char(d, 'YYYY-MM-DD') AS day,
                 COALESCE((SELECT count(*) FROM barbershops b
                           WHERE (b.created_at AT TIME ZONE ${PLATFORM_TZ})::date = d::date), 0)::int AS count
          FROM generate_series(
            ((now() AT TIME ZONE ${PLATFORM_TZ})::date - 29), (now() AT TIME ZONE ${PLATFORM_TZ})::date, interval '1 day'
          ) AS d
          ORDER BY d`,
          tx.appointment.count({ where: { createdAt: { gte: d30 }, deletedAt: null } }),
          tx.usageCounter.aggregate({
            where: { period, metric: 'whatsappPerMonth' },
            _sum: { count: true },
          }),
          tx.$queryRaw<Array<{ id: string; slug: string; name: string; appointments: number }>>`
          SELECT b.id, b.slug, b.name, count(a.id)::int AS appointments
          FROM barbershops b JOIN appointments a ON a.barbershop_id = b.id
          WHERE a.created_at >= ${d30} AND a.deleted_at IS NULL AND b.deleted_at IS NULL
          GROUP BY b.id ORDER BY appointments DESC, b.name LIMIT 5`,
        ]);

      const byStatus = <K extends string>(
        rows: Array<{ status: string; _count: { _all: number } }>,
        keys: readonly K[],
      ) =>
        Object.fromEntries(
          keys.map((k) => [k, rows.find((r) => r.status === k)?._count._all ?? 0]),
        ) as Record<K, number>;

      const shops = byStatus(shopStatus, ['onboarding', 'active', 'suspended', 'deleted'] as const);
      const subs = byStatus(subStatus, [
        'trialing',
        'active',
        'past_due',
        'suspended',
        'canceled',
      ] as const);
      const trialRows = byStatus(trials, [
        'trialing',
        'active',
        'past_due',
        'suspended',
        'canceled',
      ] as const);
      const trialStarted = Object.values(trialRows).reduce((a, b) => a + b, 0);
      const mrrRows = mrr.map((r) => ({ currency: r.currency, amountCents: Math.round(r.amount) }));

      return {
        generatedAt: now.toISOString(),
        barbershops: { total: shops.onboarding + shops.active + shops.suspended, ...shops },
        subscriptions: subs,
        mrr: mrrRows,
        arr: mrrRows.map((r) => ({ currency: r.currency, amountCents: r.amountCents * 12 })),
        churn30d: { canceled: canceled30, rate: ratio(canceled30, subs.active + canceled30) },
        trialConversion90d: {
          started: trialStarted,
          converted: trialRows.active,
          rate: ratio(trialRows.active, trialStarted),
        },
        signups30d: signups.map((s) => ({ date: s.day, count: s.count })),
        appointments30d: appts,
        whatsappThisMonth: wa._sum.count ?? 0,
        topBarbershops: top.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          appointments30d: t.appointments,
        })),
      };
    });
  }
}

function ratio(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 10_000) / 10_000;
}
