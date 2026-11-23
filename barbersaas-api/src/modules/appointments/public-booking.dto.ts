import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../common/http/zod';
import { CustomFieldSchema } from '../shop/settings.schemas';

export const PublicShopSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  branding: z.object({
    logoUrl: z.string().nullable(),
    bannerUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    primaryColor: z.string(),
    secondaryColor: z.string(),
    primaryForeground: z.string(),
    secondaryForeground: z.string(),
    font: z.string(),
    theme: z.string(),
    welcomeMessage: z.string().nullable(),
    socials: z.record(z.string(), z.string().nullable()),
  }),
  locations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      address: z.string().nullable(),
      reference: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      isPrimary: z.boolean(),
      hours: z.array(
        z.object({
          dayOfWeek: z.number().int(),
          blocks: z.array(z.object({ start: z.string(), end: z.string() })),
        }),
      ),
    }),
  ),
  categories: z.array(z.object({ id: z.uuid(), name: z.string() })),
  services: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      description: z.string().nullable(),
      imageUrl: z.string().nullable(),
      categoryId: z.uuid().nullable(),
      durationMin: z.number().int(),
      /** Rango de precio entre barberos (pueden cobrar distinto). */
      priceFromCents: z.number().int(),
      priceToCents: z.number().int(),
      staffIds: z.array(z.uuid()),
    }),
  ),
  staff: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string(),
      bio: z.string().nullable(),
      photoUrl: z.string().nullable(),
      specialties: z.array(z.string()),
    }),
  ),
  gallery: z.array(z.object({ url: z.string(), caption: z.string().nullable() })),
  booking: z.object({
    allowStaffSelection: z.boolean(),
    allowAnyStaff: z.boolean(),
    minNoticeMinutes: z.number().int(),
    maxAdvanceDays: z.number().int(),
    cancellationWindowHours: z.number().int(),
    approvalMode: z.enum(['auto', 'manual']),
    requiredFields: z.object({
      name: z.literal('required'),
      phone: z.enum(['required', 'optional', 'hidden']),
      email: z.enum(['required', 'optional', 'hidden']),
    }),
    customFields: z.array(CustomFieldSchema),
  }),
});
export class PublicShopDto extends createZodDto(PublicShopSchema) {}

export const PublicAvailabilityQuerySchema = z.object({
  serviceIds: z.union([z.uuid(), z.array(z.uuid()).min(1).max(5)]),
  /** Omitir = cualquier barbero. */
  staffId: z.uuid().optional(),
  from: z.iso.date(),
  to: z.iso.date(),
});
export class PublicAvailabilityQueryDto extends createZodDto(PublicAvailabilityQuerySchema) {}

export const PublicBookSchema = z.object({
  serviceIds: z.array(z.uuid()).min(1).max(5),
  staffId: z.uuid().nullable().default(null),
  startAt: z.iso.datetime({ offset: true }),
  customer: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(25).nullish(),
    email: z.email().max(254).nullish(),
  }),
  notes: z.string().trim().max(500).nullish(),
  customFields: z.record(z.string(), z.union([z.string().max(500), z.boolean()])).default({}),
  /** Honeypot anti-bots: debe venir vacío (el formulario lo oculta). */
  website: z.string().max(0, 'Solicitud inválida').optional(),
});
export class PublicBookDto extends createZodDto(PublicBookSchema) {}

export const PublicAppointmentSchema = z.object({
  id: z.uuid(),
  status: z.enum([
    'awaiting_payment',
    'pending',
    'confirmed',
    'in_progress',
    'completed',
    'no_show',
    'canceled',
  ]),
  startAt: IsoDate,
  endAt: IsoDate,
  timezone: z.string(),
  shop: z.object({
    name: z.string(),
    slug: z.string(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  staff: z.object({ id: z.uuid(), displayName: z.string() }),
  services: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      priceCents: z.number().int(),
      durationMin: z.number().int(),
    }),
  ),
  totalCents: z.number().int(),
  currency: z.string(),
  customerName: z.string().nullable(),
  canCancel: z.boolean(),
  canReschedule: z.boolean(),
  /** Hasta cuándo se puede cancelar/reprogramar online. */
  changeDeadline: IsoDate,
  manageToken: z.string(),
  manageUrl: z.string(),
  icsUrl: z.string(),
  /** Adelanto de la reserva (Fase 3): null si no se pidió. */
  deposit: z
    .object({
      amountCents: z.number().int(),
      status: z.enum([
        'pending',
        'paid',
        'applied',
        'refund_pending',
        'refunded',
        'retained',
        'expired',
      ]),
      /** Link de pago (solo mientras está pendiente). */
      payUrl: z.string().nullable(),
      /** Hasta cuándo se aparta el horario. */
      holdExpiresAt: IsoDate,
    })
    .nullable(),
});
export class PublicAppointmentDto extends createZodDto(PublicAppointmentSchema, { codec: true }) {}

export const PublicCancelSchema = z.object({ reason: z.string().trim().max(500).optional() });
export class PublicCancelDto extends createZodDto(PublicCancelSchema) {}

export const PublicRescheduleSchema = z.object({
  startAt: z.iso.datetime({ offset: true }),
  staffId: z.uuid().nullable().optional(),
});
export class PublicRescheduleDto extends createZodDto(PublicRescheduleSchema) {}
