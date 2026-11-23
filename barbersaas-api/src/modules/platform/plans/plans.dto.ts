import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, patchSchema } from '../../../common/http/zod';
import { PlanFeaturesSchema, PlanLimitsSchema } from '../../../common/plan-limits/plan.schemas';

const money = z.number().int().nonnegative().max(100_000_000);

export const CreatePlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Código inválido'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullish(),
  priceMonthlyCents: money,
  priceYearlyCents: money,
  currency: z.string().trim().toUpperCase().length(3).default('PEN'),
  trialDays: z.number().int().min(0).max(365).default(14),
  limits: PlanLimitsSchema.default(PlanLimitsSchema.parse({})),
  features: PlanFeaturesSchema.default(PlanFeaturesSchema.parse({})),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export class CreatePlanDto extends createZodDto(CreatePlanSchema) {}

/** limits/features se reemplazan completos (con sus defaults); el resto de campos, solo si se envían. */
export const UpdatePlanSchema = patchSchema(CreatePlanSchema.omit({ code: true })).extend({
  limits: PlanLimitsSchema.optional(),
  features: PlanFeaturesSchema.optional(),
});
export class UpdatePlanDto extends createZodDto(UpdatePlanSchema) {}

export const PlanSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceMonthlyCents: z.number().int(),
  priceYearlyCents: z.number().int(),
  currency: z.string(),
  trialDays: z.number().int(),
  limits: PlanLimitsSchema,
  features: PlanFeaturesSchema,
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
  activeSubscriptions: z.number().int(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export class PlanDto extends createZodDto(PlanSchema, { codec: true }) {}
export class PlanListDto extends createZodDto(z.array(PlanSchema), { codec: true }) {}
