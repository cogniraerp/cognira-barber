import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../../common/http/zod';
import { PlanLimitsOverrideSchema } from '../../../common/plan-limits/plan.schemas';
import { SlugSchema } from '../../barbershops/slug';

const ShopStatus = z.enum(['onboarding', 'active', 'suspended', 'deleted']);
const SubStatus = z.enum(['trialing', 'active', 'past_due', 'suspended', 'canceled']);
const Role = z.enum(['owner', 'admin', 'receptionist', 'barber']);

export const ListBarbershopsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: ShopStatus.optional(),
  planCode: z.string().trim().max(40).optional(),
  country: z.string().trim().toUpperCase().length(2).optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
  sort: z.enum(['createdAt', '-createdAt', 'name', '-name']).default('-createdAt'),
});
export class ListBarbershopsQueryDto extends createZodDto(ListBarbershopsQuerySchema) {}

const PlanRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const BarbershopListItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: ShopStatus,
  country: z.string(),
  ownerEmail: z.string().nullable(),
  createdAt: IsoDate,
  /** null para soporte (sin acceso a facturación). */
  subscription: z
    .object({
      status: SubStatus,
      plan: PlanRef,
      trialEndsAt: IsoDate.nullable(),
      currentPeriodEnd: IsoDate.nullable(),
    })
    .nullable(),
});
export class BarbershopListDto extends createZodDto(paginated(BarbershopListItemSchema), {
  codec: true,
}) {}

export const BarbershopDetailSchema = BarbershopListItemSchema.extend({
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  suspendedAt: IsoDate.nullable(),
  deletedAt: IsoDate.nullable(),
  subscription: z
    .object({
      id: z.uuid(),
      status: SubStatus,
      interval: z.enum(['month', 'year']),
      plan: PlanRef,
      trialEndsAt: IsoDate.nullable(),
      currentPeriodEnd: IsoDate.nullable(),
      discountPercent: z.number().int(),
      limitsOverride: PlanLimitsOverrideSchema.nullable(),
    })
    .nullable(),
  usage: z.object({
    staff: z.number().int(),
    locations: z.number().int(),
    services: z.number().int(),
    customers: z.number().int(),
    appointmentsThisMonth: z.number().int(),
    whatsappThisMonth: z.number().int(),
  }),
  members: z.array(
    z.object({
      id: z.uuid(),
      role: Role,
      status: z.enum(['invited', 'active', 'disabled']),
      email: z.string().nullable(),
      fullName: z.string().nullable(),
    }),
  ),
});
export class BarbershopDetailDto extends createZodDto(BarbershopDetailSchema, { codec: true }) {}

export const CreateBarbershopSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: SlugSchema,
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  planCode: z.string().trim(),
  /** Si se omite, se usan los días de prueba del plan. */
  trialDays: z.number().int().min(0).max(365).optional(),
  country: z.string().trim().toUpperCase().length(2).default('PE'),
  timezone: z.string().trim().max(60).default('America/Lima'),
  currency: z.string().trim().toUpperCase().length(3).default('PEN'),
});
export class CreateBarbershopDto extends createZodDto(CreateBarbershopSchema) {}

export const CreateBarbershopResultSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  ownerStatus: z.enum(['active', 'invited']),
  /** Solo si el owner no tenía cuenta. Se muestra una única vez (hasta que el email de invitación esté listo). */
  inviteToken: z.string().nullable(),
});
export class CreateBarbershopResultDto extends createZodDto(CreateBarbershopResultSchema) {}

export const UpdateBarbershopSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    legalName: z.string().trim().max(120).nullable(),
    taxId: z.string().trim().max(20).nullable(),
    phone: z.string().trim().max(20).nullable(),
    email: z.email().nullable(),
    country: z.string().trim().toUpperCase().length(2),
    timezone: z.string().trim().max(60),
    currency: z.string().trim().toUpperCase().length(3),
  })
  .partial();
export class UpdateBarbershopDto extends createZodDto(UpdateBarbershopSchema) {}

export const ReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class ReasonDto extends createZodDto(ReasonSchema) {}

export const ExtendTrialSchema = z.object({ days: z.number().int().min(1).max(90) });
export class ExtendTrialDto extends createZodDto(ExtendTrialSchema) {}

export const ChangePlanSchema = z.object({
  planCode: z.string().trim(),
  interval: z.enum(['month', 'year']).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  /** null = quitar overrides */
  limitsOverride: PlanLimitsOverrideSchema.nullable().optional(),
});
export class ChangePlanDto extends createZodDto(ChangePlanSchema) {}

export const ImpersonationSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  barbershop: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
});
export class ImpersonationDto extends createZodDto(ImpersonationSchema) {}
