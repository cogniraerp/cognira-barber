import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../common/http/zod';
import { SlugSchema } from '../barbershops/slug';

export const MeSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  platformRole: z.enum(['superadmin', 'support']).nullable(),
  /** null = todavía no confirmó su correo. */
  emailVerifiedAt: IsoDate.nullable(),
});
export class MeDto extends createZodDto(MeSchema, { codec: true }) {}

export const UpdateMeSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(20).nullable(),
    avatarUrl: z.url().max(500).nullable(),
    locale: z.enum(['es-PE', 'es', 'en']),
  })
  .partial();
export class UpdateMeDto extends createZodDto(UpdateMeSchema) {}

export const MyBarbershopSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['onboarding', 'active', 'suspended', 'deleted']),
  role: z.enum(['owner', 'admin', 'receptionist', 'barber']),
  logoUrl: z.string().nullable(),
});
export class MyBarbershopsDto extends createZodDto(z.array(MyBarbershopSchema)) {}

export const CreateMyBarbershopSchema = z.object({
  name: z.string().trim().min(2).max(80),
  /** Opcional: si no se envía, se genera desde el nombre. */
  slug: SlugSchema.optional(),
});
export class CreateMyBarbershopDto extends createZodDto(CreateMyBarbershopSchema) {}
export class CreatedBarbershopDto extends createZodDto(
  z.object({ id: z.uuid(), slug: z.string() }),
) {}
