import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema, patchSchema } from '../../../common/http/zod';

const money = z.number().int().min(0).max(100_000_000);

export const ProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  costCents: z.number().int(),
  stockMin: z.number().int(),
  isActive: z.boolean(),
  /** Stock total (todas las sedes) y por sede. */
  stock: z.number().int(),
  stocks: z.array(
    z.object({ locationId: z.uuid(), locationName: z.string(), quantity: z.number().int() }),
  ),
  /** Alguna sede está en el mínimo o por debajo. */
  isLow: z.boolean(),
  createdAt: IsoDate,
});
export class ProductDto extends createZodDto(ProductSchema, { codec: true }) {}
export class ProductListDto extends createZodDto(paginated(ProductSchema), { codec: true }) {}

export const ListProductsQuerySchema = PaginationQuerySchema.extend({
  /** Nombre, SKU o código de barras */
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', '-createdAt', 'stock']).default('name'),
});
export class ListProductsQueryDto extends createZodDto(ListProductsQuerySchema) {}

const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null);
export const CreateProductSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sku: optionalText(40),
  barcode: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,32}$/, 'Código de barras inválido')
    .nullable()
    .default(null),
  category: optionalText(60),
  description: optionalText(500),
  imageUrl: z.url().max(500).nullable().default(null),
  priceCents: money,
  costCents: money.default(0),
  stockMin: z.number().int().min(0).max(100_000).default(0),
  isActive: z.boolean().default(true),
  /** Stock inicial en la sede principal (se registra como movimiento de compra). */
  initialStock: z.number().int().min(0).max(100_000).optional(),
});
export class CreateProductDto extends createZodDto(CreateProductSchema) {}
export class UpdateProductDto extends createZodDto(
  patchSchema(CreateProductSchema.omit({ initialStock: true })),
) {}

export class ProductCategoriesDto extends createZodDto(
  z.array(z.object({ category: z.string(), count: z.number().int() })),
) {}

export const MovementSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['purchase', 'sale', 'adjustment', 'return']),
  quantity: z.number().int(),
  balance: z.number().int(),
  unitCostCents: z.number().int().nullable(),
  note: z.string().nullable(),
  saleId: z.uuid().nullable(),
  product: z.object({ id: z.uuid(), name: z.string(), sku: z.string().nullable() }),
  location: z.object({ id: z.uuid(), name: z.string() }),
  createdBy: z.string().nullable(),
  createdAt: IsoDate,
});
export class MovementListDto extends createZodDto(paginated(MovementSchema), { codec: true }) {}

export const ListMovementsQuerySchema = PaginationQuerySchema.extend({
  productId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  kind: z.enum(['purchase', 'sale', 'adjustment', 'return']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export class ListMovementsQueryDto extends createZodDto(ListMovementsQuerySchema) {}

/**
 * Ingreso de compra o ajuste de varios productos a la vez en una sede.
 *  - purchase: `quantity` > 0 (unidades que entran); `unitCostCents` actualiza el costo del producto.
 *  - adjustment: `quantity` = diferencia (+/−) o `counted` = lo contado (se calcula la diferencia).
 */
export const CreateMovementSchema = z
  .object({
    kind: z.enum(['purchase', 'adjustment']),
    /** Por defecto, la sede principal. */
    locationId: z.uuid().optional(),
    note: z.string().trim().max(300).nullable().default(null),
    items: z
      .array(
        z.object({
          productId: z.uuid(),
          quantity: z.number().int().min(-100_000).max(100_000).optional(),
          counted: z.number().int().min(0).max(100_000).optional(),
          unitCostCents: money.optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((v, ctx) => {
    v.items.forEach((it, i) => {
      if (v.kind === 'purchase' && !(it.quantity && it.quantity > 0))
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'quantity'],
          message: 'La compra debe tener cantidad mayor a 0',
        });
      if (v.kind === 'adjustment' && (it.quantity === undefined) === (it.counted === undefined))
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'quantity'],
          message: 'Indica la diferencia o lo contado (uno de los dos)',
        });
    });
    if (v.kind === 'adjustment' && !v.note)
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Indica el motivo del ajuste' });
  });
export class CreateMovementDto extends createZodDto(CreateMovementSchema) {}
export class MovementResultDto extends createZodDto(
  z.object({ created: z.number().int(), skipped: z.number().int() }),
) {}
