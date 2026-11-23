import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  IsoDate,
  IsoDay,
  paginated,
  PaginationQuerySchema,
  patchSchema,
} from '../../common/http/zod';

const tag = z.string().trim().toLowerCase().min(1).max(30);

export const CustomerSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  birthday: IsoDay.nullable(),
  tags: z.array(z.string()),
  isBlocked: z.boolean(),
  waOptIn: z.boolean(),
  noShowCount: z.number().int(),
  hasAccount: z.boolean(),
  stats: z.object({
    visits: z.number().int(),
    totalSpentCents: z.number().int(),
    lastVisitAt: IsoDate.nullable(),
    nextAppointmentAt: IsoDate.nullable(),
    /** Días promedio entre visitas completadas (null con menos de 2). */
    avgDaysBetweenVisits: z.number().nullable(),
  }),
  createdAt: IsoDate,
});
export class CustomerDto extends createZodDto(CustomerSchema, { codec: true }) {}
export class CustomerListDto extends createZodDto(paginated(CustomerSchema), { codec: true }) {}

export const ListCustomersQuerySchema = PaginationQuerySchema.extend({
  /** Nombre, teléfono o email */
  q: z.string().trim().max(100).optional(),
  tag: tag.optional(),
  blocked: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', '-createdAt', '-lastVisitAt']).default('name'),
});
export class ListCustomersQueryDto extends createZodDto(ListCustomersQuerySchema) {}

export const CreateCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(25).nullable().default(null),
  email: z.email().max(254).nullable().default(null),
  birthday: z.iso.date().nullable().default(null),
  tags: z.array(tag).max(20).default([]),
  waOptIn: z.boolean().default(true),
});
export class CreateCustomerDto extends createZodDto(CreateCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(patchSchema(CreateCustomerSchema)) {}

export const BlockSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export class BlockDto extends createZodDto(BlockSchema) {}

export const MergeSchema = z.object({ sourceId: z.uuid() });
export class MergeDto extends createZodDto(MergeSchema) {}

export const NoteSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  imageUrl: z.string().nullable(),
  author: z.object({ membershipId: z.uuid(), fullName: z.string().nullable() }).nullable(),
  createdAt: IsoDate,
});
export class NoteDto extends createZodDto(NoteSchema, { codec: true }) {}
export class NoteListDto extends createZodDto(z.array(NoteSchema), { codec: true }) {}
export const CreateNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  imageUrl: z.url().max(500).nullable().default(null),
});
export class CreateNoteDto extends createZodDto(CreateNoteSchema) {}

export const HistoryItemSchema = z.object({
  id: z.uuid(),
  startAt: IsoDate,
  status: z.enum(['awaiting_payment', 'pending', 'confirmed', 'in_progress', 'completed', 'no_show', 'canceled']),
  staff: z.object({ id: z.uuid(), displayName: z.string() }),
  services: z.array(z.string()),
  totalCents: z.number().int(),
});
export class HistoryDto extends createZodDto(paginated(HistoryItemSchema), { codec: true }) {}

export class TagsDto extends createZodDto(
  z.array(z.object({ tag: z.string(), count: z.number().int() })),
) {}

export const ImportQuerySchema = z.object({ dryRun: z.enum(['true', 'false']).default('false') });
export class ImportQueryDto extends createZodDto(ImportQuerySchema) {}
export const ImportResultSchema = z.object({
  dryRun: z.boolean(),
  rows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  /** Columnas reconocidas del archivo. */
  columns: z.array(z.string()),
});
export class ImportResultDto extends createZodDto(ImportResultSchema) {}
