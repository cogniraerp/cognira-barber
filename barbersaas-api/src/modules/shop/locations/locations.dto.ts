import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDay, patchSchema } from '../../../common/http/zod';
import { HHmm, isValidTimeZone } from '../../../common/time/time-blocks';
import { LocationWeekResponseSchema, LocationWeekSchema } from './week.schemas';

export const LocationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  reference: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string().nullable(),
  timezone: z.string().nullable(),
  isPrimary: z.boolean(),
});
export class LocationDto extends createZodDto(LocationSchema) {}
export class LocationListDto extends createZodDto(z.array(LocationSchema)) {}

export const CreateLocationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).nullable().default(null),
  reference: z.string().trim().max(200).nullable().default(null),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  phone: z.string().trim().max(20).nullable().default(null),
  /** null = la de la barbería */
  timezone: z.string().refine(isValidTimeZone, 'Zona horaria inválida').nullable().default(null),
});
export class CreateLocationDto extends createZodDto(CreateLocationSchema) {}
export class UpdateLocationDto extends createZodDto(patchSchema(CreateLocationSchema)) {}

export class LocationWeekDto extends createZodDto(LocationWeekSchema) {}
export class LocationWeekResponseDto extends createZodDto(LocationWeekResponseSchema) {}

export const HolidaySchema = z.object({
  id: z.uuid(),
  date: IsoDay,
  name: z.string(),
  locationId: z.uuid().nullable(),
  source: z.enum(['manual', 'pe_national']),
});
export class HolidayListDto extends createZodDto(z.array(HolidaySchema), { codec: true }) {}
export class HolidayDto extends createZodDto(HolidaySchema, { codec: true }) {}

export const CreateHolidaySchema = z.object({
  date: z.iso.date(),
  name: z.string().trim().min(2).max(80),
  /** null = todas las sedes */
  locationId: z.uuid().nullable().default(null),
});
export class CreateHolidayDto extends createZodDto(CreateHolidaySchema) {}

export const HolidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});
export class HolidaysQueryDto extends createZodDto(HolidaysQuerySchema) {}

export const ImportHolidaysSchema = z.object({ year: z.number().int().min(2020).max(2100) });
export class ImportHolidaysDto extends createZodDto(ImportHolidaysSchema) {}
export class ImportHolidaysResultDto extends createZodDto(
  z.object({ created: z.number().int(), skipped: z.number().int() }),
) {}

export const ExceptionSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  date: IsoDay,
  isClosed: z.boolean(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  reason: z.string().nullable(),
});
export class ExceptionDto extends createZodDto(ExceptionSchema, { codec: true }) {}
export class ExceptionListDto extends createZodDto(z.array(ExceptionSchema), { codec: true }) {}

export const CreateExceptionSchema = z
  .object({
    locationId: z.uuid(),
    date: z.iso.date(),
    isClosed: z.boolean(),
    opensAt: HHmm.optional(),
    closesAt: HHmm.optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine((e, ctx) => {
    if (!e.isClosed && (!e.opensAt || !e.closesAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['opensAt'],
        message: 'Indica el horario especial o marca el día como cerrado',
      });
    } else if (!e.isClosed && e.opensAt! >= e.closesAt!) {
      ctx.addIssue({
        code: 'custom',
        path: ['closesAt'],
        message: 'La hora de cierre debe ser posterior a la de apertura',
      });
    }
  });
export class CreateExceptionDto extends createZodDto(CreateExceptionSchema) {}

export const ExceptionsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  locationId: z.uuid().optional(),
});
export class ExceptionsQueryDto extends createZodDto(ExceptionsQuerySchema) {}
