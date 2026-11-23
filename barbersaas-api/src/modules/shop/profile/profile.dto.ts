import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SlugSchema } from '../../barbershops/slug';
import { BookingRulesSchema, BrandingSchema, PreferencesSchema } from '../settings.schemas';
import { patchSchema } from '../../../common/http/zod';
import { PermissionOverridesSchema, PERMISSIONS } from '../../../common/rbac/permissions';

const Category = z.enum(['barbershop', 'salon', 'spa']);

export const ProfileSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: Category,
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(['onboarding', 'active', 'suspended', 'deleted']),
  address: z
    .object({
      locationId: z.uuid(),
      address: z.string().nullable(),
      reference: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    })
    .nullable(),
});
export class ProfileDto extends createZodDto(ProfileSchema) {}

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'Teléfono inválido');

export const UpdateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    /** Solo el owner. Cambia {slug}.barbersaas.com y el enlace de reservas. */
    slug: SlugSchema,
    description: z.string().trim().max(1000).nullable(),
    category: Category,
    legalName: z.string().trim().max(120).nullable(),
    /** RUC peruano: 11 dígitos. */
    taxId: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'El RUC tiene 11 dígitos')
      .nullable(),
    phone: phone.nullable(),
    email: z.email().max(254).nullable(),
    address: z
      .object({
        address: z.string().trim().max(200).nullable(),
        reference: z.string().trim().max(200).nullable(),
        lat: z.number().min(-90).max(90).nullable(),
        lng: z.number().min(-180).max(180).nullable(),
      })
      .partial(),
  })
  .partial();
export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

export const BrandingResponseSchema = BrandingSchema.extend({
  /** Color de texto legible (WCAG) sobre primary/secondary: el frontend lo usa en el tema dinámico. */
  primaryForeground: z.enum(['#ffffff', '#000000']),
  secondaryForeground: z.enum(['#ffffff', '#000000']),
});
export class BrandingDto extends createZodDto(BrandingResponseSchema) {}

export const UpdateBrandingSchema = patchSchema(BrandingSchema).strict();
export class UpdateBrandingDto extends createZodDto(UpdateBrandingSchema) {}

export const GalleryImageSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  caption: z.string().nullable(),
  sortOrder: z.number().int(),
  isVisible: z.boolean(),
});
export class GalleryImageDto extends createZodDto(GalleryImageSchema) {}
export class GalleryListDto extends createZodDto(z.array(GalleryImageSchema)) {}

export const CreateGalleryImageSchema = z.object({
  url: z.url().max(500),
  caption: z.string().trim().max(200).nullish(),
  isVisible: z.boolean().default(true),
});
export class CreateGalleryImageDto extends createZodDto(CreateGalleryImageSchema) {}
export const UpdateGalleryImageSchema = patchSchema(CreateGalleryImageSchema.omit({ url: true }));
export class UpdateGalleryImageDto extends createZodDto(UpdateGalleryImageSchema) {}
export const ReorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) });
export class ReorderDto extends createZodDto(ReorderSchema) {}

export class BookingRulesDto extends createZodDto(BookingRulesSchema) {}

export const GeneralSettingsSchema = PreferencesSchema.extend({
  locale: z.enum(['es-PE', 'es', 'en']),
  timezone: z.string().refine(isValidTimeZone, 'Zona horaria inválida'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
});
export class GeneralSettingsDto extends createZodDto(GeneralSettingsSchema) {}
export class UpdateGeneralSettingsDto extends createZodDto(patchSchema(GeneralSettingsSchema)) {}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ConfigurableRole = z.enum(['admin', 'receptionist', 'barber']);
export const PermissionMatrixSchema = z.object({
  catalog: z.array(z.enum(PERMISSIONS)),
  roles: z.array(
    z.object({
      role: ConfigurableRole,
      defaults: z.array(z.enum(PERMISSIONS)),
      overrides: PermissionOverridesSchema,
      effective: z.array(z.enum(PERMISSIONS)),
    }),
  ),
});
export class PermissionMatrixDto extends createZodDto(PermissionMatrixSchema) {}
export const UpdatePermissionsSchema = z.partialRecord(ConfigurableRole, PermissionOverridesSchema);
export class UpdatePermissionsDto extends createZodDto(UpdatePermissionsSchema) {}
