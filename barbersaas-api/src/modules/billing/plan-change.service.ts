import { HttpStatus, Injectable } from '@nestjs/common';
import { addMonths, addYears } from 'date-fns';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { parseFeatures, parseLimits } from '../../common/plan-limits/plan.schemas';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { invoiceNumber } from '../platform/billing/platform-billing.service';
import { classifyChange, limitBlockers, prorate, type Interval } from './plan-change';

const SYSTEM: DbContext = { kind: 'system' };
const LIMIT_LABEL = { staff: 'barberos', locations: 'sedes', services: 'servicios' } as const;
const planSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  priceMonthlyCents: true,
  priceYearlyCents: true,
  currency: true,
  limits: true,
  features: true,
} as const;

/**
 * Cambio de plan desde la barbería (Configuración → Suscripción). La suscripción solo la escribe la
 * plataforma (RLS), así que tras validar el permiso del dueño se escribe como sistema.
 *  - En prueba: se cambia al instante, sin factura.
 *  - Subir de plan: al instante + factura por la diferencia prorrateada del periodo en curso.
 *  - Bajar de plan o cambiar mensual/anual: programado para el fin del periodo pagado.
 */
@Injectable()
export class PlanChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Planes disponibles, con lo que pasaría al elegir cada uno (en el intervalo actual). */
  async options(t: TenantContext, now = new Date()) {
    const [plans, sub, usage] = await Promise.all([
      this.prisma.run(SYSTEM, (tx) =>
        tx.plan.findMany({
          where: { isPublic: true, deletedAt: null },
          select: planSelect,
          orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
        }),
      ),
      this.prisma.run(SYSTEM, (tx) => loadSub(tx, t.barbershopId)),
      this.prisma.run(tenantDb(t), (tx) => usageOf(tx, t.barbershopId)),
    ]);
    const cur = { planId: sub.planId, plan: sub.plan, interval: sub.interval };
    return {
      currentPlanCode: sub.plan.code,
      interval: sub.interval,
      status: sub.status,
      canChange: canChange(sub.status),
      pending: sub.pendingEffectiveAt
        ? {
            planCode: (sub.pendingPlan ?? sub.plan).code,
            planName: (sub.pendingPlan ?? sub.plan).name,
            interval: sub.pendingInterval ?? sub.interval,
            effectiveAt: sub.pendingEffectiveAt,
          }
        : null,
      usage,
      plans: plans.map((p) => {
        const c = classifyChange(cur, { planId: p.id, plan: p, interval: sub.interval });
        const limits = parseLimits(p.limits);
        return {
          code: p.code,
          name: p.name,
          description: p.description,
          priceMonthlyCents: p.priceMonthlyCents,
          priceYearlyCents: p.priceYearlyCents,
          currency: p.currency,
          limits: { staff: limits.staff, locations: limits.locations, services: limits.services },
          features: parseFeatures(p.features),
          change:
            sub.status === 'trialing' && c.kind !== 'none'
              ? ('now' as const)
              : c.kind === 'upgrade'
                ? ('now' as const)
                : c.kind === 'scheduled'
                  ? ('scheduled' as const)
                  : ('current' as const),
          prorationCents:
            c.kind === 'upgrade' && sub.status !== 'trialing' ? this.prorationFor(sub, p, now) : 0,
          blockers:
            c.kind === 'scheduled'
              ? limitBlockers(parseLimits(p.limits, sub.limitsOverride), usage)
              : [],
        };
      }),
    };
  }

  async change(t: TenantContext, dto: { planCode: string; interval: Interval }, now = new Date()) {
    const usage = await this.prisma.run(tenantDb(t), (tx) => usageOf(tx, t.barbershopId));
    return this.prisma.run(SYSTEM, async (tx) => {
      await tx.$queryRaw`SELECT id FROM subscriptions WHERE barbershop_id = ${t.barbershopId}::uuid FOR UPDATE`;
      const sub = await loadSub(tx, t.barbershopId);
      if (!canChange(sub.status))
        throw AppError.conflict('Paga las facturas pendientes antes de cambiar de plan');
      const target = await tx.plan.findFirst({
        where: { code: dto.planCode, isPublic: true, deletedAt: null },
        select: planSelect,
      });
      if (!target) throw AppError.notFound('Plan');
      const c = classifyChange(
        { planId: sub.planId, plan: sub.plan, interval: sub.interval },
        { planId: target.id, plan: target, interval: dto.interval },
      );
      if (c.kind === 'none') throw AppError.conflict('Ya tienes ese plan');
      let invoice: { id: string; amountCents: number } | null = null;
      let result: 'changed' | 'scheduled';

      if (sub.status === 'trialing') {
        // En prueba: cambia al instante (la primera factura saldrá con el plan nuevo).
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            planId: target.id,
            interval: dto.interval,
            pendingPlanId: null,
            pendingInterval: null,
            pendingEffectiveAt: null,
          },
        });
        result = 'changed';
      } else if (c.kind === 'upgrade') {
        const amountCents = this.prorationFor(sub, target, now);
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            planId: target.id,
            pendingPlanId: null,
            ...(c.scheduleInterval
              ? { pendingInterval: dto.interval, pendingEffectiveAt: sub.currentPeriodEnd ?? now }
              : { pendingInterval: null, pendingEffectiveAt: null }),
          },
        });
        if (amountCents > 0 && sub.currentPeriodEnd) {
          const inv = await tx.invoice.create({
            data: {
              barbershopId: t.barbershopId,
              subscriptionId: sub.id,
              number: invoiceNumber(now),
              amountCents,
              currency: target.currency,
              status: 'open',
              periodStart: now,
              // Cubre lo que queda del periodo en curso (no lo extiende).
              periodEnd: sub.currentPeriodEnd,
              dueAt: now,
              notes: `Diferencia por cambio de ${sub.plan.name} a ${target.name}`,
            },
            select: { id: true, amountCents: true },
          });
          invoice = inv;
        }
        result = 'changed';
      } else {
        const blockers = limitBlockers(parseLimits(target.limits, sub.limitsOverride), usage);
        if (blockers.length)
          throw new AppError(
            ErrorCode.CONFLICT,
            HttpStatus.CONFLICT,
            `Para pasar a ${target.name} tienes que quedarte con ${blockers.map((b) => `${b.max} ${LIMIT_LABEL[b.key]} (tienes ${b.current})`).join(' y ')}`,
            { blockers },
          );
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            pendingPlanId: target.id === sub.planId ? null : target.id,
            pendingInterval: dto.interval === sub.interval ? null : dto.interval,
            pendingEffectiveAt: sub.currentPeriodEnd ?? now,
          },
        });
        result = 'scheduled';
      }
      await this.audit.record(tx, {
        action: `billing.plan.${result === 'changed' ? 'change' : 'schedule'}`,
        barbershopId: t.barbershopId,
        entity: 'subscription',
        entityId: sub.id,
        diff: {
          from: sub.plan.code,
          to: target.code,
          interval: dto.interval,
          invoice: invoice?.amountCents ?? null,
        },
      });
      return { result, invoice };
    });
  }

  /** Cancela el cambio programado (sigue con su plan actual). */
  async cancelScheduled(t: TenantContext) {
    await this.prisma.run(SYSTEM, async (tx) => {
      const sub = await loadSub(tx, t.barbershopId);
      if (!sub.pendingEffectiveAt) throw AppError.conflict('No hay ningún cambio programado');
      await tx.subscription.update({
        where: { id: sub.id },
        data: { pendingPlanId: null, pendingInterval: null, pendingEffectiveAt: null },
      });
      await this.audit.record(tx, {
        action: 'billing.plan.schedule_canceled',
        barbershopId: t.barbershopId,
        entity: 'subscription',
        entityId: sub.id,
      });
    });
  }

  private prorationFor(
    sub: {
      interval: Interval;
      discountPercent: number;
      currentPeriodEnd: Date | null;
      plan: { priceMonthlyCents: number; priceYearlyCents: number };
    },
    to: { priceMonthlyCents: number; priceYearlyCents: number },
    now: Date,
  ): number {
    if (!sub.currentPeriodEnd) return 0;
    const periodStart =
      sub.interval === 'year'
        ? addYears(sub.currentPeriodEnd, -1)
        : addMonths(sub.currentPeriodEnd, -1);
    return prorate({
      from: sub.plan,
      to,
      interval: sub.interval,
      discountPercent: sub.discountPercent,
      periodStart,
      periodEnd: sub.currentPeriodEnd,
      now,
    });
  }
}

const canChange = (status: string) => status === 'trialing' || status === 'active';

async function loadSub(tx: Tx, barbershopId: string) {
  const sub = await tx.subscription.findFirst({
    where: { barbershopId, deletedAt: null },
    select: {
      id: true,
      status: true,
      planId: true,
      interval: true,
      discountPercent: true,
      currentPeriodEnd: true,
      limitsOverride: true,
      pendingInterval: true,
      pendingEffectiveAt: true,
      plan: { select: { code: true, name: true, priceMonthlyCents: true, priceYearlyCents: true } },
      pendingPlan: { select: { code: true, name: true } },
    },
  });
  if (!sub) throw AppError.notFound('Suscripción');
  return sub;
}

async function usageOf(tx: Tx, barbershopId: string) {
  const where = { barbershopId, deletedAt: null };
  const [staff, locations, services] = await Promise.all([
    tx.staff.count({ where: { ...where, isActive: true } }),
    tx.location.count({ where }),
    tx.service.count({ where }),
  ]);
  return { staff, locations, services };
}
