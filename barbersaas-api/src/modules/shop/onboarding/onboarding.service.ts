import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { readBranding } from '../settings.schemas';

export const ONBOARDING_STEPS = [
  'profile',
  'branding',
  'hours',
  'services',
  'staff',
  'whatsapp',
  'share',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Pasos que se infieren de los datos: no se pueden "marcar" a mano. */
const DERIVED: ReadonlySet<OnboardingStep> = new Set(['profile', 'hours', 'services', 'staff']);
/** Mínimo para poder publicar la página de reservas. */
const REQUIRED: ReadonlySet<OnboardingStep> = new Set(['profile', 'hours', 'services', 'staff']);

const StoredSchema = z
  .object({
    completedSteps: z.array(z.enum(ONBOARDING_STEPS)).catch([]),
    dismissed: z.boolean().catch(false),
  })
  .catch({ completedSteps: [], dismissed: false });

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get(t: TenantContext) {
    return this.prisma.run(tenantDb(t), (tx) => this.compute(tx, t));
  }

  update(t: TenantContext, dto: { completeStep?: OnboardingStep; dismissed?: boolean }) {
    if (dto.completeStep && DERIVED.has(dto.completeStep)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Ese paso se completa automáticamente al cargar los datos',
        {
          errors: [{ path: 'completeStep', message: 'Paso automático' }],
        },
      );
    }
    return this.prisma.run(tenantDb(t), async (tx) => {
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { onboarding: true },
      });
      const stored = StoredSchema.parse(shop.onboarding);
      const completed = new Set(stored.completedSteps);
      if (dto.completeStep) completed.add(dto.completeStep);
      await tx.barbershop.update({
        where: { id: t.barbershopId },
        data: {
          onboarding: {
            completedSteps: [...completed],
            dismissed: dto.dismissed ?? stored.dismissed,
          },
        },
      });
      return this.compute(tx, t);
    });
  }

  /** Publica la barbería (onboarding → active) cuando tiene lo mínimo para recibir reservas. */
  activate(t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const state = await this.compute(tx, t);
      if (state.status !== 'onboarding') throw AppError.conflict('La barbería ya está publicada');
      if (!state.canActivate) {
        throw AppError.conflict('Faltan pasos obligatorios', ErrorCode.CONFLICT, {
          missing: state.steps.filter((s) => s.required && !s.done).map((s) => s.key),
        });
      }
      await tx.barbershop.update({ where: { id: t.barbershopId }, data: { status: 'active' } });
      await this.audit.record(tx, {
        action: 'shop.onboarding.activate',
        barbershopId: t.barbershopId,
        entity: 'barbershop',
        entityId: t.barbershopId,
      });
      return this.compute(tx, t);
    });
  }

  private async compute(tx: Tx, t: TenantContext) {
    const id = t.barbershopId;
    const base = { barbershopId: id, deletedAt: null };
    const [shop, location, hours, services, staff, wa] = await Promise.all([
      tx.barbershop.findUniqueOrThrow({
        where: { id },
        select: { slug: true, status: true, phone: true, branding: true, onboarding: true },
      }),
      tx.location.findFirst({ where: { ...base, isPrimary: true }, select: { address: true } }),
      tx.businessHour.count({ where: base }),
      tx.service.count({ where: { ...base, isActive: true } }),
      tx.staff.count({ where: { ...base, isActive: true } }),
      tx.whatsappConfig.findUnique({ where: { barbershopId: id }, select: { status: true } }),
    ]);
    const stored = StoredSchema.parse(shop.onboarding);
    const manual = new Set(stored.completedSteps);
    const derived: Record<OnboardingStep, boolean> = {
      profile: Boolean(shop.phone && location?.address),
      branding: Boolean(readBranding(shop.branding).logoUrl),
      hours: hours > 0,
      services: services > 0,
      staff: staff > 0,
      whatsapp: wa?.status === 'ok',
      share: false,
    };
    const steps = ONBOARDING_STEPS.map((key) => ({
      key,
      required: REQUIRED.has(key),
      done: derived[key] || (!DERIVED.has(key) && manual.has(key)),
    }));
    const done = steps.filter((s) => s.done).length;
    return {
      status: shop.status,
      steps,
      progress: Math.round((done / steps.length) * 100),
      canActivate: steps.every((s) => !s.required || s.done),
      dismissed: stored.dismissed,
      bookingUrl: `${this.env.WEB_URL.replace(/\/$/, '')}/b/${shop.slug}`,
    };
  }
}
