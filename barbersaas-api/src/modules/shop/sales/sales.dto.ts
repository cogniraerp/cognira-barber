import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../../common/http/zod';
import { Method } from '../cash/cash.dto';

const money = z.number().int().min(0).max(100_000_000);

export const SaleSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  /** "V-000123" */
  code: z.string(),
  status: z.enum(['completed', 'voided']),
  createdAt: IsoDate,
  createdBy: z.string().nullable(),
  customer: z
    .object({ id: z.uuid(), fullName: z.string(), phone: z.string().nullable() })
    .nullable(),
  appointmentId: z.uuid().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['service', 'product']),
      serviceId: z.uuid().nullable(),
      productId: z.uuid().nullable(),
      staff: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
      name: z.string(),
      quantity: z.number().int(),
      unitPriceCents: z.number().int(),
      discountCents: z.number().int(),
      totalCents: z.number().int(),
    }),
  ),
  payments: z.array(
    z.object({ method: Method, amountCents: z.number().int(), reference: z.string().nullable() }),
  ),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  tipCents: z.number().int(),
  tipStaff: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  totalCents: z.number().int(),
  currency: z.string(),
  notes: z.string().nullable(),
  voidedAt: IsoDate.nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.string().nullable(),
});
export class SaleDto extends createZodDto(SaleSchema, { codec: true }) {}
export class SaleListDto extends createZodDto(paginated(SaleSchema), { codec: true }) {}

export const CreateSaleSchema = z
  .object({
    /** Cobrar una cita: se marca como completada y no se puede cobrar dos veces. */
    appointmentId: z.uuid().nullable().default(null),
    customerId: z.uuid().nullable().default(null),
    locationId: z.uuid().optional(),
    items: z
      .array(
        z.object({
          kind: z.enum(['service', 'product']),
          serviceId: z.uuid().optional(),
          productId: z.uuid().optional(),
          staffId: z.uuid().nullable().default(null),
          quantity: z.number().int().min(1).max(999).default(1),
          /** Por defecto: precio del barbero (servicios) o del catálogo (productos). */
          unitPriceCents: money.optional(),
          discountCents: money.default(0),
        }),
      )
      .min(1)
      .max(50),
    /** Descuento sobre el total de la venta (además del de cada ítem). */
    discountCents: money.default(0),
    tipCents: money.default(0),
    tipStaffId: z.uuid().nullable().default(null),
    payments: z
      .array(
        z.object({
          method: Method,
          amountCents: money.refine((v) => v > 0, 'Monto mayor a 0'),
          reference: z.string().trim().max(60).nullable().default(null),
          /** Pago "online": el cobro por link/QR ya pagado que respalda este pago. */
          chargeId: z.uuid().optional(),
        }),
      )
      .min(1)
      .max(6),
    notes: z.string().trim().max(300).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const charges = new Set<string>();
    v.payments.forEach((p, i) => {
      if (p.method === 'online' && !p.chargeId)
        ctx.addIssue({
          code: 'custom',
          path: ['payments', i, 'chargeId'],
          message: 'Falta el cobro en línea',
        });
      if (p.method !== 'online' && p.chargeId)
        ctx.addIssue({
          code: 'custom',
          path: ['payments', i, 'chargeId'],
          message: 'Solo los pagos en línea llevan cobro',
        });
      if (p.chargeId && charges.has(p.chargeId))
        ctx.addIssue({
          code: 'custom',
          path: ['payments', i, 'chargeId'],
          message: 'Cobro repetido',
        });
      if (p.chargeId) charges.add(p.chargeId);
    });
    v.items.forEach((it, i) => {
      if (it.kind === 'service' && !it.serviceId)
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'serviceId'],
          message: 'Falta el servicio',
        });
      if (it.kind === 'product' && !it.productId)
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'productId'],
          message: 'Falta el producto',
        });
    });
  });
export class CreateSaleDto extends createZodDto(CreateSaleSchema) {}

export const VoidSaleSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export class VoidSaleDto extends createZodDto(VoidSaleSchema) {}

export const ListSalesQuerySchema = PaginationQuerySchema.extend({
  /** Número (123 o V-000123) o nombre del cliente. */
  q: z.string().trim().max(100).optional(),
  status: z.enum(['completed', 'voided']).optional(),
  method: Method.optional(),
  staffId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export class ListSalesQueryDto extends createZodDto(ListSalesQuerySchema) {}

export const SalesSummarySchema = z.object({
  count: z.number().int(),
  totalCents: z.number().int(),
  tipCents: z.number().int(),
});
export class SaleListWithSummaryDto extends createZodDto(
  paginated(SaleSchema).extend({ summary: SalesSummarySchema }),
  { codec: true },
) {}
