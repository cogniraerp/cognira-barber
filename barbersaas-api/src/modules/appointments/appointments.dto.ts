import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../common/http/zod';

const Status = z.enum([
  'awaiting_payment',
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'no_show',
  'canceled',
]);
const Source = z.enum(['online', 'walk_in', 'staff', 'phone']);
/** `?serviceIds=a&serviceIds=b` o `?serviceIds=a` */
const UuidList = z.union([z.uuid(), z.array(z.uuid()).min(1).max(5)]);

export const AvailabilityQuerySchema = z.object({
  serviceIds: UuidList,
  staffId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  /** Fechas locales de la sede (YYYY-MM-DD), máx. 31 días. */
  from: z.iso.date(),
  to: z.iso.date(),
});
export class AvailabilityQueryDto extends createZodDto(AvailabilityQuerySchema) {}

export const AvailabilitySchema = z.object({
  timezone: z.string(),
  days: z.array(
    z.object({
      date: z.iso.date(),
      slots: z.array(z.object({ start: IsoDate, staffIds: z.array(z.uuid()).optional() })),
    }),
  ),
  staff: z.array(
    z.object({
      staffId: z.uuid(),
      displayName: z.string(),
      durationMin: z.number().int(),
      priceCents: z.number().int(),
    }),
  ),
});
export class AvailabilityDto extends createZodDto(AvailabilitySchema, { codec: true }) {}

export const AppointmentSchema = z.object({
  id: z.uuid(),
  status: Status,
  source: Source,
  startAt: IsoDate,
  endAt: IsoDate,
  locationId: z.uuid(),
  staff: z.object({ id: z.uuid(), displayName: z.string() }),
  customer: z
    .object({
      id: z.uuid(),
      fullName: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      noShowCount: z.number().int(),
    })
    .nullable(),
  items: z.array(
    z.object({
      serviceId: z.uuid(),
      name: z.string(),
      priceCents: z.number().int(),
      durationMin: z.number().int(),
    }),
  ),
  totalCents: z.number().int(),
  currency: z.string(),
  customerNotes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  cancelReason: z.string().nullable(),
  /** Venta con la que se cobró (null = aún no se cobra). */
  saleId: z.uuid().nullable(),
  /** Adelanto pagado al reservar: en caja se usa como pago "online" con su chargeId. */
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
      chargeId: z.uuid().nullable(),
    })
    .nullable(),
  createdAt: IsoDate,
});
export class AppointmentDto extends createZodDto(AppointmentSchema, { codec: true }) {}
export class AppointmentListDto extends createZodDto(z.array(AppointmentSchema), { codec: true }) {}

export const ListAppointmentsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  staffId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: z.union([Status, z.array(Status)]).optional(),
});
export class ListAppointmentsQueryDto extends createZodDto(ListAppointmentsQuerySchema) {}

const CustomerRef = z.union([
  z.object({ id: z.uuid() }),
  z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(25).nullish(),
    email: z.email().max(254).nullish(),
  }),
]);

export const CreateAppointmentSchema = z.object({
  serviceIds: z.array(z.uuid()).min(1).max(5),
  /** null = cualquier barbero disponible */
  staffId: z.uuid().nullable(),
  /** Para walk-in se puede omitir: empieza ahora. */
  startAt: z.iso.datetime({ offset: true }).optional(),
  customer: CustomerRef.nullable().default(null),
  source: z.enum(['walk_in', 'staff', 'phone']).default('staff'),
  status: z.enum(['pending', 'confirmed', 'in_progress']).default('confirmed'),
  customerNotes: z.string().trim().max(1000).nullish(),
  internalNotes: z.string().trim().max(1000).nullish(),
  /** Saltar horarios/reglas (fuera de horario, sobre un descanso). Nunca permite superponer citas. */
  force: z.boolean().default(false),
});
export class CreateAppointmentDto extends createZodDto(CreateAppointmentSchema) {}

export const RescheduleSchema = z.object({
  startAt: z.iso.datetime({ offset: true }),
  staffId: z.uuid().optional(),
  force: z.boolean().default(false),
});
export class RescheduleDto extends createZodDto(RescheduleSchema) {}

export const ChangeStatusSchema = z.object({
  status: z.enum(['confirmed', 'in_progress', 'completed', 'no_show', 'canceled']),
  reason: z.string().trim().max(500).optional(),
});
export class ChangeStatusDto extends createZodDto(ChangeStatusSchema) {}

export const UpdateNotesSchema = z.object({
  internalNotes: z.string().trim().max(1000).nullable().optional(),
  customerNotes: z.string().trim().max(1000).nullable().optional(),
});
export class UpdateNotesDto extends createZodDto(UpdateNotesSchema) {}

export const SlotTakenSchema = z.object({
  code: z.literal('SLOT_TAKEN'),
  alternatives: z.array(z.iso.datetime()),
});
