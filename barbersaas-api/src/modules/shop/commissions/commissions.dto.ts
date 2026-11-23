import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../../common/http/zod';
import { Method } from '../cash/cash.dto';
import { CommissionConfigSchema, RuleSchema } from './rules';

export class CommissionConfigDto extends createZodDto(CommissionConfigSchema) {}
export class CommissionConfigOutDto extends createZodDto(CommissionConfigSchema) {}

const Staff = z.object({ id: z.uuid(), displayName: z.string() });

export const SummaryRowSchema = z.object({
  staff: Staff,
  /** Servicios y productos atendidos en el período (sin contar reversos). */
  servicesCount: z.number().int(),
  productsCount: z.number().int(),
  baseCents: z.number().int(),
  commissionCents: z.number().int(),
  tipCents: z.number().int(),
  /** Comisión + propinas del período (ya descontados los reversos). */
  earnedCents: z.number().int(),
  /** Todo lo pendiente de liquidar (cualquier fecha). */
  pendingCents: z.number().int(),
  lastPayoutAt: IsoDate.nullable(),
  config: CommissionConfigSchema,
});
export class CommissionSummaryDto extends createZodDto(
  z.object({
    rows: z.array(SummaryRowSchema),
    totals: z.object({
      earnedCents: z.number().int(),
      pendingCents: z.number().int(),
      tipCents: z.number().int(),
    }),
  }),
  { codec: true },
) {}

export const PeriodQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export class PeriodQueryDto extends createZodDto(PeriodQuerySchema) {}

export const EntrySchema = z.object({
  id: z.uuid(),
  staff: Staff,
  kind: z.enum(['service', 'product', 'tip']),
  description: z.string(),
  baseCents: z.number().int(),
  rule: RuleSchema,
  amountCents: z.number().int(),
  earnedAt: IsoDate,
  saleId: z.uuid(),
  saleCode: z.string(),
  /** Entrada negativa por anulación de la venta. */
  isReversal: z.boolean(),
  status: z.enum(['pending', 'paid']),
  payoutId: z.uuid().nullable(),
});
export class EntryListDto extends createZodDto(paginated(EntrySchema), { codec: true }) {}

export const EntriesQuerySchema = PaginationQuerySchema.extend({
  staffId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(['pending', 'paid']).optional(),
});
export class EntriesQueryDto extends createZodDto(EntriesQuerySchema) {}

export const PayoutSchema = z.object({
  id: z.uuid(),
  staff: Staff,
  periodTo: IsoDate,
  totalCents: z.number().int(),
  entriesCount: z.number().int(),
  method: Method,
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: IsoDate,
});
export class PayoutDto extends createZodDto(PayoutSchema, { codec: true }) {}
export class PayoutListDto extends createZodDto(paginated(PayoutSchema), { codec: true }) {}

export const PayoutsQuerySchema = PaginationQuerySchema.extend({ staffId: z.uuid().optional() });
export class PayoutsQueryDto extends createZodDto(PayoutsQuerySchema) {}

export const CreatePayoutSchema = z.object({
  staffId: z.uuid(),
  /** Se liquida todo lo pendiente ganado hasta esta fecha (por defecto, ahora). */
  to: z.iso.datetime({ offset: true }).optional(),
  method: Method.default('cash'),
  note: z.string().trim().max(300).nullable().default(null),
  /** Pago en efectivo: registrar la salida en la caja abierta. */
  registerInCash: z.boolean().default(false),
});
export class CreatePayoutDto extends createZodDto(CreatePayoutSchema) {}

export const MyCommissionsSchema = z.object({
  summary: SummaryRowSchema,
  entries: z.array(EntrySchema),
  payouts: z.array(PayoutSchema),
});
export class MyCommissionsDto extends createZodDto(MyCommissionsSchema, { codec: true }) {}
