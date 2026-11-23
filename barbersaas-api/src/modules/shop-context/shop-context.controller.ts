import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { PlanFeaturesSchema, PlanLimitsSchema } from '../../common/plan-limits/plan.schemas';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { AllowSuspended, CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import type { TenantContext } from '../../common/tenancy/tenant.types';

const ShopContextSchema = z.object({
  barbershop: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    status: z.enum(['onboarding', 'active', 'suspended', 'deleted']),
    /** Por qué está suspendida: billing (falta de pago, se reactiva al pagar) o manual. */
    suspendedReason: z.enum(['manual', 'billing']).nullable(),
    timezone: z.string(),
    currency: z.string(),
    locale: z.string(),
  }),
  role: z.enum(['owner', 'admin', 'receptionist', 'barber']),
  staffId: z.uuid().nullable(),
  /** Membresía del usuario (null al impersonar): p. ej. para saber qué notas son propias. */
  membershipId: z.uuid().nullable(),
  /** Rol personalizado (p. ej. "Cajero"); null = el rol del sistema. */
  customRole: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
  impersonatedBy: z.enum(['superadmin', 'support']).nullable(),
  plan: z.object({ code: z.string(), limits: PlanLimitsSchema, features: PlanFeaturesSchema }),
});
class ShopContextDto extends createZodDto(ShopContextSchema) {}

/** Lo que el frontend necesita al entrar al panel: barbería, rol, permisos efectivos y plan. */
@ApiTags('shop')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/context')
export class ShopContextController {
  constructor(private readonly plans: PlanLimitsService) {}

  @Get()
  @AllowSuspended()
  @ZodResponse({ type: ShopContextDto })
  async get(@CurrentTenant() t: TenantContext) {
    const ent = await this.plans.entitlements(t.barbershopId);
    return {
      barbershop: {
        id: t.barbershopId,
        slug: t.slug,
        name: t.name,
        status: t.status,
        suspendedReason: (t.suspendedReason ?? null) as 'manual' | 'billing' | null,
        timezone: t.timezone,
        currency: t.currency,
        locale: t.locale,
      },
      role: t.role,
      staffId: t.staffId,
      membershipId: t.membershipId,
      customRole: t.customRole ?? null,
      permissions: [...t.permissions].sort(),
      impersonatedBy: t.impersonatedBy ?? null,
      plan: { code: ent.planCode, limits: ent.limits, features: ent.features },
    };
  }
}
