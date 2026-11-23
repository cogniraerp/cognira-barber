import { z } from 'zod';

/** null = ilimitado */
const limit = z.number().int().nonnegative().nullable();

const LIMIT_KEYS = [
  'staff',
  'locations',
  'services',
  'bookingsPerMonth',
  'whatsappPerMonth',
  'storageMb',
] as const;

export const PlanLimitsSchema = z.object(
  Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit.default(null)])) as Record<
    (typeof LIMIT_KEYS)[number],
    z.ZodDefault<typeof limit>
  >,
);

/**
 * Overrides por suscripción: SIN defaults. Ojo: en Zod 4, `.partial()` sobre un campo con
 * `.default()` sigue aplicando el default, y un override vacío dejaría todo en "ilimitado".
 */
export const PlanLimitsOverrideSchema = z.object(
  Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit.optional()])) as Record<
    (typeof LIMIT_KEYS)[number],
    z.ZodOptional<typeof limit>
  >,
);
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;
export type LimitKey = keyof PlanLimits;

export const PlanFeaturesSchema = z.object({
  loyalty: z.boolean().default(false),
  advancedReports: z.boolean().default(false),
  onlinePayments: z.boolean().default(false),
  multiLocation: z.boolean().default(false),
  api: z.boolean().default(false),
  customDomain: z.boolean().default(false),
  removeBranding: z.boolean().default(false),
});
export type PlanFeatures = z.infer<typeof PlanFeaturesSchema>;
export type FeatureKey = keyof PlanFeatures;

/** Lee JSON de la BD de forma tolerante: claves desconocidas o inválidas → valor por defecto. */
export function parseLimits(raw: unknown, override?: unknown): PlanLimits {
  const base = PlanLimitsSchema.catch(PlanLimitsSchema.parse({})).parse(raw ?? {});
  const extra = PlanLimitsOverrideSchema.safeParse(override ?? {});
  return extra.success ? { ...base, ...stripUndefined(extra.data) } : base;
}

export function parseFeatures(raw: unknown): PlanFeatures {
  return PlanFeaturesSchema.catch(PlanFeaturesSchema.parse({})).parse(raw ?? {});
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
