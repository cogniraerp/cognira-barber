import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../../common/http/zod';

const InvoiceStatus = z.enum(['draft', 'open', 'paid', 'void', 'failed']);

export const ListInvoicesQuerySchema = PaginationQuerySchema.extend({
  status: InvoiceStatus.optional(),
  barbershopId: z.uuid().optional(),
});
export class ListInvoicesQueryDto extends createZodDto(ListInvoicesQuerySchema) {}

export const InvoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: InvoiceStatus,
  amountCents: z.number().int(),
  currency: z.string(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  dueAt: IsoDate,
  paidAt: IsoDate.nullable(),
  gatewayRef: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: IsoDate,
  barbershop: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
});
export class InvoiceDto extends createZodDto(InvoiceSchema, { codec: true }) {}
export class InvoiceListDto extends createZodDto(paginated(InvoiceSchema), { codec: true }) {}

export const CreateInvoiceSchema = z.object({
  /** Si se omite: precio del plan según el intervalo, con el descuento de la suscripción. */
  amountCents: z.number().int().nonnegative().optional(),
  dueInDays: z.number().int().min(0).max(60).default(7),
  notes: z.string().trim().max(500).optional(),
});
export class CreateInvoiceDto extends createZodDto(CreateInvoiceSchema) {}

export const MarkPaidSchema = z.object({
  paidAt: z.iso.datetime().optional(),
  /** Nº de operación Yape/transferencia, id de la pasarela, etc. */
  gatewayRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});
export class MarkPaidDto extends createZodDto(MarkPaidSchema) {}
