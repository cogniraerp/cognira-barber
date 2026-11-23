import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../../common/http/zod';

export const METHODS = ['cash', 'yape', 'plin', 'card', 'transfer', 'other', 'online'] as const;
export const Method = z.enum(METHODS);
const money = z.number().int().min(0).max(100_000_000);

const MethodTotals = z.object({
  method: Method,
  /** Entradas (ventas + ingresos) y salidas (egresos, retiros, devoluciones). */
  inCents: z.number().int(),
  outCents: z.number().int(),
  /** Lo que debería haber de ese método (efectivo: incluye el fondo inicial). */
  expectedCents: z.number().int(),
  countedCents: z.number().int().nullable(),
  differenceCents: z.number().int().nullable(),
});

export const CashMovementSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['income', 'expense', 'withdrawal', 'sale', 'refund']),
  method: Method,
  amountCents: z.number().int(),
  concept: z.string(),
  saleId: z.uuid().nullable(),
  createdBy: z.string().nullable(),
  createdAt: IsoDate,
});

export const ShiftSchema = z.object({
  id: z.uuid(),
  status: z.enum(['open', 'closed']),
  register: z.object({ id: z.uuid(), name: z.string() }),
  openedAt: IsoDate,
  openedBy: z.string().nullable(),
  openingCents: z.number().int(),
  closedAt: IsoDate.nullable(),
  closedBy: z.string().nullable(),
  notes: z.string().nullable(),
  totals: z.array(MethodTotals),
  totalInCents: z.number().int(),
  totalOutCents: z.number().int(),
  /** Al cerrar: contado − esperado (negativo = faltante). */
  differenceCents: z.number().int().nullable(),
  movementsCount: z.number().int(),
});
export class ShiftDto extends createZodDto(ShiftSchema, { codec: true }) {}
export class ShiftListDto extends createZodDto(paginated(ShiftSchema), { codec: true }) {}

export const ShiftDetailSchema = ShiftSchema.extend({ movements: z.array(CashMovementSchema) });
export class ShiftDetailDto extends createZodDto(ShiftDetailSchema, { codec: true }) {}

export const CurrentCashSchema = z.object({
  register: z.object({ id: z.uuid(), name: z.string(), locationName: z.string() }),
  /** null = la caja está cerrada. */
  shift: ShiftDetailSchema.nullable(),
});
export class CurrentCashDto extends createZodDto(CurrentCashSchema, { codec: true }) {}

export const CashQuerySchema = z.object({ locationId: z.uuid().optional() });
export class CashQueryDto extends createZodDto(CashQuerySchema) {}

export const OpenShiftSchema = z.object({
  locationId: z.uuid().optional(),
  /** Fondo inicial en efectivo (sencillo para dar vuelto). */
  openingCents: money,
  notes: z.string().trim().max(300).nullable().default(null),
});
export class OpenShiftDto extends createZodDto(OpenShiftSchema) {}

export const CreateCashMovementSchema = z.object({
  locationId: z.uuid().optional(),
  kind: z.enum(['income', 'expense', 'withdrawal']),
  method: Method.default('cash'),
  amountCents: money.refine((v) => v > 0, 'El monto debe ser mayor a 0'),
  concept: z.string().trim().min(2).max(160),
});
export class CreateCashMovementDto extends createZodDto(CreateCashMovementSchema) {}

export const CloseShiftSchema = z.object({
  locationId: z.uuid().optional(),
  /** Lo contado por método. El efectivo es obligatorio; los demás, si se omiten, se dan por cuadrados. */
  counted: z
    .partialRecord(Method, money)
    .refine((v) => v.cash !== undefined, { message: 'Falta el efectivo contado', path: ['cash'] }),
  notes: z.string().trim().max(500).nullable().default(null),
});
export class CloseShiftDto extends createZodDto(CloseShiftSchema) {}

export const ShiftsQuerySchema = PaginationQuerySchema.extend({
  locationId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export class ShiftsQueryDto extends createZodDto(ShiftsQuerySchema) {}
