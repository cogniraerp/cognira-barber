import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { AppError, ErrorCode } from '../errors/app-error';
import {
  parseFeatures,
  parseLimits,
  type FeatureKey,
  type LimitKey,
  type PlanFeatures,
  type PlanLimits,
} from './plan.schemas';

export interface Entitlements {
  planCode: string;
  limits: PlanLimits;
  features: PlanFeatures;
}

/** Métricas que se cuentan en tiempo real sobre tablas (las mensuales van en usage_counters). */
type CountedKey = Extract<LimitKey, 'staff' | 'locations' | 'services'>;
type MonthlyKey = Extract<LimitKey, 'bookingsPerMonth' | 'whatsappPerMonth'>;

@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Plan + overrides de la barbería. Se lee en contexto 'system' porque soporte (impersonando)
   * no puede leer suscripciones por RLS, pero los límites se aplican igual.
   */
  async entitlements(barbershopId: string): Promise<Entitlements> {
    const sub = await this.prisma.run({ kind: 'system', barbershopId }, (tx) =>
      tx.subscription.findFirst({
        where: { barbershopId, deletedAt: null },
        select: {
          limitsOverride: true,
          plan: { select: { code: true, limits: true, features: true } },
        },
      }),
    );
    if (!sub) {
      // Sin suscripción: todo bloqueado salvo lo mínimo. No debería ocurrir (el alta crea una prueba).
      return {
        planCode: 'none',
        limits: parseLimits({
          staff: 0,
          locations: 0,
          services: 0,
          bookingsPerMonth: 0,
          whatsappPerMonth: 0,
          storageMb: 0,
        }),
        features: parseFeatures({}),
      };
    }
    return {
      planCode: sub.plan.code,
      limits: parseLimits(sub.plan.limits, sub.limitsOverride),
      features: parseFeatures(sub.plan.features),
    };
  }

  /** Llamar DENTRO de la transacción de creación, antes del insert. */
  async assertCanCreate(tx: Tx, barbershopId: string, key: CountedKey): Promise<void> {
    const { limits } = await this.entitlements(barbershopId);
    const max = limits[key];
    if (max === null) return;
    const where = { barbershopId, deletedAt: null };
    const current =
      key === 'staff'
        ? await tx.staff.count({ where: { ...where, isActive: true } })
        : key === 'locations'
          ? await tx.location.count({ where })
          : await tx.service.count({ where });
    if (current >= max) throw limitReached(key, max);
  }

  /** Incrementa el uso mensual y falla si supera el límite (atómico, en la misma transacción). */
  async consume(
    tx: Tx,
    barbershopId: string,
    key: MonthlyKey,
    amount = 1,
    now = new Date(),
  ): Promise<void> {
    const { limits } = await this.entitlements(barbershopId);
    const period = now.toISOString().slice(0, 7);
    const row = await tx.usageCounter.upsert({
      where: { barbershopId_period_metric: { barbershopId, period, metric: key } },
      create: { barbershopId, period, metric: key, count: amount },
      update: { count: { increment: amount } },
      select: { count: true },
    });
    const max = limits[key];
    if (max !== null && row.count > max) throw limitReached(key, max);
  }

  async assertFeature(barbershopId: string, feature: FeatureKey): Promise<void> {
    const { features } = await this.entitlements(barbershopId);
    if (!features[feature]) {
      throw new AppError(
        ErrorCode.PLAN_LIMIT_REACHED,
        HttpStatus.PAYMENT_REQUIRED,
        'Tu plan no incluye esta función',
        {
          feature,
        },
      );
    }
  }
}

function limitReached(limit: LimitKey, max: number): AppError {
  return new AppError(
    ErrorCode.PLAN_LIMIT_REACHED,
    HttpStatus.PAYMENT_REQUIRED,
    'Alcanzaste el límite de tu plan',
    {
      limit,
      max,
    },
  );
}
