import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { patchSchema } from '../../../common/http/zod';
import { DepositRuleSchema } from '../settings.schemas';

const money = z.number().int().min(0).max(10_000_000);
const duration = z.number().int().min(5).max(600);
const buffer = z.number().int().min(0).max(120);

export const CategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  servicesCount: z.number().int(),
});
export class CategoryDto extends createZodDto(CategorySchema) {}
export class CategoryListDto extends createZodDto(z.array(CategorySchema)) {}
export const CreateCategorySchema = z.object({ name: z.string().trim().min(2).max(60) });
export class CreateCategoryDto extends createZodDto(CreateCategorySchema) {}

export const ServiceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  priceCents: z.number().int(),
  durationMin: z.number().int(),
  bufferBeforeMin: z.number().int(),
  bufferAfterMin: z.number().int(),
  isOnlineBookable: z.boolean(),
  /** Excepción del adelanto para este servicio (null = regla general de la barbería). */
  depositOverride: DepositRuleSchema.nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Barberos que lo realizan, con su precio/duración propios si los tienen. */
  staff: z.array(
    z.object({
      staffId: z.uuid(),
      displayName: z.string(),
      priceCents: z.number().int(),
      durationMin: z.number().int(),
      isOverridden: z.boolean(),
    }),
  ),
});
export class ServiceDto extends createZodDto(ServiceSchema) {}
export class ServiceListDto extends createZodDto(z.array(ServiceSchema)) {}

export const CreateServiceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).nullable().default(null),
  imageUrl: z.url().max(500).nullable().default(null),
  categoryId: z.uuid().nullable().default(null),
  priceCents: money,
  durationMin: duration,
  bufferBeforeMin: buffer.default(0),
  bufferAfterMin: buffer.default(0),
  isOnlineBookable: z.boolean().default(true),
  depositOverride: DepositRuleSchema.nullable().default(null),
  isActive: z.boolean().default(true),
  /** Atajo: asignarlo a estos barberos (con el precio/duración base). */
  staffIds: z.array(z.uuid()).max(100).optional(),
});
export class CreateServiceDto extends createZodDto(CreateServiceSchema) {}
export const UpdateServiceSchema = patchSchema(CreateServiceSchema.omit({ staffIds: true }));
export class UpdateServiceDto extends createZodDto(UpdateServiceSchema) {}

export const ServicesQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
  categoryId: z.uuid().optional(),
});
export class ServicesQueryDto extends createZodDto(ServicesQuerySchema) {}

export const ReorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });
export class ReorderDto extends createZodDto(ReorderSchema) {}

/** Asignación barbero ↔ servicio con overrides opcionales. Se usa desde ambos lados. */
export const StaffServiceItemSchema = z.object({
  serviceId: z.uuid(),
  priceCentsOverride: money.nullable().default(null),
  durationMinOverride: duration.nullable().default(null),
});
export const SetStaffServicesSchema = z
  .object({ items: z.array(StaffServiceItemSchema).max(200) })
  .refine((v) => new Set(v.items.map((i) => i.serviceId)).size === v.items.length, {
    message: 'Servicio repetido',
    path: ['items'],
  });
export class SetStaffServicesDto extends createZodDto(SetStaffServicesSchema) {}
