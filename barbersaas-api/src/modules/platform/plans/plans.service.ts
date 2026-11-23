import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import type { AuthUser } from '../../../common/auth/auth.types';
import { platformDb } from '../../../common/auth/platform-db';
import { AppError } from '../../../common/errors/app-error';
import { parseFeatures, parseLimits } from '../../../common/plan-limits/plan.schemas';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import type { CreatePlanDto, UpdatePlanDto } from './plans.dto';

const planSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  priceMonthlyCents: true,
  priceYearlyCents: true,
  currency: true,
  trialDays: true,
  limits: true,
  features: true,
  isPublic: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { subscriptions: { where: { status: { in: ['trialing', 'active', 'past_due'] } } } },
  },
} as const satisfies Prisma.PlanSelect;

type PlanRow = Prisma.PlanGetPayload<{ select: typeof planSelect }>;

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser) {
    return this.prisma.run(platformDb(user), async (tx) =>
      (
        await tx.plan.findMany({
          where: { deletedAt: null },
          select: planSelect,
          orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
        })
      ).map(toDto),
    );
  }

  get(user: AuthUser, id: string) {
    return this.prisma.run(platformDb(user), async (tx) => toDto(await this.find(tx, id)));
  }

  async create(user: AuthUser, dto: CreatePlanDto) {
    try {
      return await this.prisma.run(platformDb(user), async (tx) => {
        const plan = await tx.plan.create({ data: dto, select: planSelect });
        await this.audit.record(tx, {
          action: 'platform.plan.create',
          entity: 'plan',
          entityId: plan.id,
          diff: dto,
        });
        return toDto(plan);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppError.conflict('Ya existe un plan con ese código');
      }
      throw e;
    }
  }

  update(user: AuthUser, id: string, dto: UpdatePlanDto) {
    return this.prisma.run(platformDb(user), async (tx) => {
      await this.find(tx, id);
      const plan = await tx.plan.update({ where: { id }, data: dto, select: planSelect });
      await this.audit.record(tx, {
        action: 'platform.plan.update',
        entity: 'plan',
        entityId: id,
        diff: dto,
      });
      return toDto(plan);
    });
  }

  /** Soft delete: deja de ofrecerse; las suscripciones existentes lo conservan. */
  remove(user: AuthUser, id: string) {
    return this.prisma.run(platformDb(user), async (tx) => {
      await this.find(tx, id);
      await tx.plan.update({ where: { id }, data: { deletedAt: new Date(), isPublic: false } });
      await this.audit.record(tx, { action: 'platform.plan.delete', entity: 'plan', entityId: id });
    });
  }

  private async find(tx: Tx, id: string): Promise<PlanRow> {
    const plan = await tx.plan.findFirst({ where: { id, deletedAt: null }, select: planSelect });
    if (!plan) throw AppError.notFound('Plan');
    return plan;
  }
}

function toDto({ _count, limits, features, ...p }: PlanRow) {
  return {
    ...p,
    limits: parseLimits(limits),
    features: parseFeatures(features),
    activeSubscriptions: _count.subscriptions,
  };
}
