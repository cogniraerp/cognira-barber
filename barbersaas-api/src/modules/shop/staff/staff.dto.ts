import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, patchSchema } from '../../../common/http/zod';
import { StaffWeekResponseSchema, StaffWeekSchema } from '../locations/week.schemas';

export const StaffSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  specialties: z.array(z.string()),
  socials: z.object({ instagram: z.string().nullable(), tiktok: z.string().nullable() }),
  locationId: z.uuid().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  servicesCount: z.number().int(),
  /** Acceso al sistema (null = perfil sin login). */
  member: z
    .object({ id: z.uuid(), email: z.string().nullable(), role: z.string(), status: z.string() })
    .nullable(),
});
export class StaffDto extends createZodDto(StaffSchema) {}
export class StaffListDto extends createZodDto(z.array(StaffSchema)) {}

export const CreateStaffSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(500).nullable().default(null),
  photoUrl: z.url().max(500).nullable().default(null),
  specialties: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  socials: z
    .object({
      instagram: z.string().trim().max(100).nullable().default(null),
      tiktok: z.string().trim().max(100).nullable().default(null),
    })
    .default({ instagram: null, tiktok: null }),
  /** null = sede principal */
  locationId: z.uuid().nullable().default(null),
  isActive: z.boolean().default(true),
});
export class CreateStaffDto extends createZodDto(CreateStaffSchema) {}
export class UpdateStaffDto extends createZodDto(patchSchema(CreateStaffSchema)) {}

export const StaffQuerySchema = z.object({ includeInactive: z.enum(['true', 'false']).optional() });
export class StaffQueryDto extends createZodDto(StaffQuerySchema) {}

export class StaffWeekDto extends createZodDto(StaffWeekSchema) {}
export class StaffWeekResponseDto extends createZodDto(StaffWeekResponseSchema) {}

const TimeOffKind = z.enum(['vacation', 'absence', 'block']);
export const TimeOffSchema = z.object({
  id: z.uuid(),
  startsAt: IsoDate,
  endsAt: IsoDate,
  kind: TimeOffKind,
  reason: z.string().nullable(),
});
export class TimeOffDto extends createZodDto(TimeOffSchema, { codec: true }) {}
export class TimeOffListDto extends createZodDto(z.array(TimeOffSchema), { codec: true }) {}

export const CreateTimeOffSchema = z
  .object({
    /** ISO-8601 con zona (p. ej. 2027-03-01T13:00:00-05:00). Se guarda en UTC. */
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    kind: TimeOffKind.default('block'),
    reason: z.string().trim().max(200).nullable().default(null),
    /** Crear aunque choque con citas existentes (las citas no se cancelan solas). */
    ignoreConflicts: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const s = Date.parse(v.startsAt);
    const e = Date.parse(v.endsAt);
    if (e <= s)
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'El fin debe ser posterior al inicio',
      });
    if (e - s > 366 * 86_400_000)
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Máximo un año' });
  });
export class CreateTimeOffDto extends createZodDto(CreateTimeOffSchema) {}

export const TimeOffQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export class TimeOffQueryDto extends createZodDto(TimeOffQuerySchema) {}

/** Ausencias y bloqueos de todos los barberos en un rango (agenda). */
export const AgendaTimeOffQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  staffId: z.uuid().optional(),
});
export class AgendaTimeOffQueryDto extends createZodDto(AgendaTimeOffQuerySchema) {}
export const AgendaTimeOffSchema = TimeOffSchema.extend({ staffId: z.uuid() });
export class AgendaTimeOffListDto extends createZodDto(z.array(AgendaTimeOffSchema), {
  codec: true,
}) {}

export const StaffServiceSchema = z.object({
  serviceId: z.uuid(),
  name: z.string(),
  basePriceCents: z.number().int(),
  baseDurationMin: z.number().int(),
  priceCentsOverride: z.number().int().nullable(),
  durationMinOverride: z.number().int().nullable(),
  priceCents: z.number().int(),
  durationMin: z.number().int(),
});
export class StaffServiceListDto extends createZodDto(z.array(StaffServiceSchema)) {}
