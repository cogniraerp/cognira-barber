import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { pageArgs } from '../../../common/http/zod';
import { can, tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import type {
  CreateMovementDto,
  CreateProductDto,
  ListMovementsQueryDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './inventory.dto';

const productSelect = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  category: true,
  description: true,
  imageUrl: true,
  priceCents: true,
  costCents: true,
  stockMin: true,
  isActive: true,
  createdAt: true,
  stocks: {
    select: {
      locationId: true,
      quantity: true,
      location: { select: { name: true, deletedAt: true } },
    },
  },
} as const satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

/**
 * Productos y stock por sede. El stock solo cambia a través de movimientos (compra, venta,
 * ajuste, devolución), cada uno en la misma transacción que actualiza `product_stocks`, con la
 * fila bloqueada (SELECT … FOR UPDATE) para que dos operaciones simultáneas no se pisen.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Ver el catálogo: quien gestiona productos, el inventario o la caja (vende en mostrador). */
  assertCanView(t: TenantContext): void {
    if (!['products.manage', 'inventory.manage', 'cash.manage'].some((p) => can(t, p as never)))
      throw AppError.forbidden();
  }

  list(t: TenantContext, q: ListProductsQueryDto) {
    this.assertCanView(t);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const where: Prisma.ProductWhereInput = {
        barbershopId: t.barbershopId,
        deletedAt: null,
        ...(q.status ? { isActive: q.status === 'active' } : {}),
        ...(q.category ? { category: { equals: q.category, mode: 'insensitive' } } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { sku: { contains: q.q, mode: 'insensitive' } },
                { barcode: { equals: q.q } },
              ],
            }
          : {}),
      };
      if (q.lowStock === 'true') where.id = { in: await lowStockIds(tx, t.barbershopId) };
      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        q.sort === '-createdAt' ? [{ createdAt: 'desc' }] : [{ name: 'asc' }];
      const [rows, total] = await Promise.all([
        tx.product.findMany({
          where,
          select: productSelect,
          orderBy: [...orderBy, { id: 'asc' }],
          ...(q.sort === 'stock' ? {} : pageArgs(q)),
        }),
        tx.product.count({ where }),
      ]);
      let items = rows.map(toDto);
      // Orden por stock (menos primero): se ordena en memoria porque es una suma por sedes.
      if (q.sort === 'stock')
        items = items
          .sort((a, b) => a.stock - b.stock)
          .slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(t: TenantContext, id: string) {
    this.assertCanView(t);
    return this.prisma.run(tenantDb(t), async (tx) => toDto(await find(tx, t.barbershopId, id)));
  }

  categories(t: TenantContext) {
    this.assertCanView(t);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const rows = await tx.product.groupBy({
        by: ['category'],
        where: { barbershopId: t.barbershopId, deletedAt: null, category: { not: null } },
        _count: { _all: true },
        orderBy: { category: 'asc' },
      });
      return rows.map((r) => ({ category: r.category!, count: r._count._all }));
    });
  }

  create(t: TenantContext, dto: CreateProductDto) {
    const { initialStock, ...data } = dto;
    return this.prisma.run(tenantDb(t), async (tx) => {
      await assertUnique(tx, t.barbershopId, dto.sku, dto.barcode);
      const p = await tx.product.create({
        data: { ...data, barbershopId: t.barbershopId },
        select: { id: true },
      });
      if (initialStock) {
        const loc = await resolveLocation(tx, t.barbershopId);
        await move(tx, t, {
          productId: p.id,
          locationId: loc,
          kind: 'purchase',
          quantity: initialStock,
          unitCostCents: dto.costCents,
          note: 'Stock inicial',
        });
      }
      await this.audit.record(tx, {
        action: 'shop.product.create',
        barbershopId: t.barbershopId,
        entity: 'product',
        entityId: p.id,
        diff: { name: dto.name, initialStock },
      });
      return toDto(await find(tx, t.barbershopId, p.id));
    });
  }

  update(t: TenantContext, id: string, dto: UpdateProductDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const cur = await find(tx, t.barbershopId, id);
      await assertUnique(
        tx,
        t.barbershopId,
        dto.sku !== undefined && dto.sku?.toLowerCase() !== cur.sku?.toLowerCase() ? dto.sku : null,
        dto.barcode !== undefined && dto.barcode !== cur.barcode ? dto.barcode : null,
      );
      await tx.product.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        action: 'shop.product.update',
        barbershopId: t.barbershopId,
        entity: 'product',
        entityId: id,
        diff: dto,
      });
      return toDto(await find(tx, t.barbershopId, id));
    });
  }

  /** Se archiva (el historial de movimientos y ventas lo sigue referenciando). */
  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await find(tx, t.barbershopId, id);
      await tx.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await this.audit.record(tx, {
        action: 'shop.product.delete',
        barbershopId: t.barbershopId,
        entity: 'product',
        entityId: id,
      });
    });
  }

  movements(t: TenantContext, q: ListMovementsQueryDto) {
    this.assertCanView(t);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const where: Prisma.InventoryMovementWhereInput = {
        barbershopId: t.barbershopId,
        ...(q.productId ? { productId: q.productId } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.inventoryMovement.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...pageArgs(q),
          select: {
            id: true,
            kind: true,
            quantity: true,
            balance: true,
            unitCostCents: true,
            note: true,
            saleId: true,
            createdAt: true,
            createdByUserId: true,
            product: { select: { id: true, name: true, sku: true } },
            location: { select: { id: true, name: true } },
          },
        }),
        tx.inventoryMovement.count({ where }),
      ]);
      // Nombre de quien lo registró (usuarios: tabla global, se leen aparte).
      const userIds = [
        ...new Set(rows.map((r) => r.createdByUserId).filter((x): x is string => !!x)),
      ];
      const users = userIds.length
        ? await tx.membership.findMany({
            where: { barbershopId: t.barbershopId, userId: { in: userIds } },
            select: { userId: true, user: { select: { fullName: true, email: true } } },
          })
        : [];
      const name = new Map(users.map((u) => [u.userId, u.user?.fullName ?? u.user?.email ?? null]));
      return {
        items: rows.map(({ createdByUserId, ...r }) => ({
          ...r,
          createdBy: createdByUserId ? (name.get(createdByUserId) ?? null) : null,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  createMovements(t: TenantContext, dto: CreateMovementDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const locationId = await resolveLocation(tx, t.barbershopId, dto.locationId);
      const ids = [...new Set(dto.items.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: { id: { in: ids }, barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      if (products.length !== ids.length) throw AppError.notFound('Producto');
      let created = 0;
      let skipped = 0;
      for (const it of dto.items) {
        let quantity = it.quantity ?? 0;
        if (dto.kind === 'adjustment' && it.counted !== undefined) {
          quantity = it.counted - (await lockStock(tx, t.barbershopId, it.productId, locationId));
        }
        if (quantity === 0) {
          skipped++; // contado = stock actual: nada que ajustar
          continue;
        }
        await move(tx, t, {
          productId: it.productId,
          locationId,
          kind: dto.kind,
          quantity,
          unitCostCents: it.unitCostCents ?? null,
          note: dto.note,
        });
        if (dto.kind === 'purchase' && it.unitCostCents !== undefined)
          await tx.product.update({
            where: { id: it.productId },
            data: { costCents: it.unitCostCents },
          });
        created++;
      }
      await this.audit.record(tx, {
        action: `shop.inventory.${dto.kind}`,
        barbershopId: t.barbershopId,
        entity: 'location',
        entityId: locationId,
        diff: { items: dto.items, note: dto.note },
      });
      return { created, skipped };
    });
  }
}

// ─────────────────────────── utilidades ───────────────────────────

/** Bloquea (o crea) la fila de stock y devuelve la cantidad actual. */
async function lockStock(
  tx: Tx,
  barbershopId: string,
  productId: string,
  locationId: string,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO product_stocks (barbershop_id, product_id, location_id, quantity, updated_at)
    VALUES (${barbershopId}::uuid, ${productId}::uuid, ${locationId}::uuid, 0, now())
    ON CONFLICT (product_id, location_id) DO NOTHING`;
  const [row] = await tx.$queryRaw<Array<{ quantity: number }>>`
    SELECT quantity FROM product_stocks WHERE product_id = ${productId}::uuid AND location_id = ${locationId}::uuid FOR UPDATE`;
  return row?.quantity ?? 0;
}

/**
 * Registra un movimiento y actualiza el stock. Exportado para el POS (ventas/devoluciones).
 * El stock no puede quedar negativo salvo `allowNegative` (venta con la opción de la barbería).
 */
export async function move(
  tx: Tx,
  t: Pick<TenantContext, 'barbershopId' | 'userId'>,
  m: {
    productId: string;
    locationId: string;
    kind: 'purchase' | 'sale' | 'adjustment' | 'return';
    quantity: number;
    unitCostCents?: number | null;
    note?: string | null;
    saleId?: string | null;
    allowNegative?: boolean;
  },
): Promise<number> {
  const current = await lockStock(tx, t.barbershopId, m.productId, m.locationId);
  const balance = current + m.quantity;
  if (balance < 0 && !m.allowNegative) {
    throw new AppError(
      ErrorCode.CONFLICT,
      409,
      `Stock insuficiente: hay ${current} y se piden ${-m.quantity}`,
      { productId: m.productId, available: current },
    );
  }
  await tx.productStock.update({
    where: { productId_locationId: { productId: m.productId, locationId: m.locationId } },
    data: { quantity: balance },
  });
  await tx.inventoryMovement.create({
    data: {
      barbershopId: t.barbershopId,
      productId: m.productId,
      locationId: m.locationId,
      kind: m.kind,
      quantity: m.quantity,
      balance,
      unitCostCents: m.unitCostCents ?? null,
      note: m.note ?? null,
      saleId: m.saleId ?? null,
      createdByUserId: t.userId,
    },
  });
  return balance;
}

export async function resolveLocation(
  tx: Tx,
  barbershopId: string,
  locationId?: string,
): Promise<string> {
  const loc = await tx.location.findFirst({
    where: {
      barbershopId,
      deletedAt: null,
      ...(locationId ? { id: locationId } : { isPrimary: true }),
    },
    select: { id: true },
  });
  if (!loc) throw AppError.notFound('Sede');
  return loc.id;
}

async function find(tx: Tx, barbershopId: string, id: string): Promise<ProductRow> {
  const p = await tx.product.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: productSelect,
  });
  if (!p) throw AppError.notFound('Producto');
  return p;
}

async function assertUnique(
  tx: Tx,
  barbershopId: string,
  sku: string | null | undefined,
  barcode: string | null | undefined,
) {
  if (sku) {
    const c = await tx.product.findFirst({
      where: { barbershopId, deletedAt: null, sku: { equals: sku, mode: 'insensitive' } },
      select: { id: true },
    });
    if (c)
      throw AppError.conflict(`Ya existe un producto con el SKU "${sku}"`, ErrorCode.CONFLICT, {
        field: 'sku',
      });
  }
  if (barcode) {
    const c = await tx.product.findFirst({
      where: { barbershopId, deletedAt: null, barcode },
      select: { id: true },
    });
    if (c)
      throw AppError.conflict(
        `Ya existe un producto con el código ${barcode}`,
        ErrorCode.CONFLICT,
        { field: 'barcode' },
      );
  }
}

/** Productos con stock mínimo definido y alguna sede (o ninguna fila aún) en el mínimo o por debajo. */
async function lowStockIds(tx: Tx, barbershopId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM products p
    WHERE p.barbershop_id = ${barbershopId}::uuid AND p.deleted_at IS NULL AND p.is_active AND p.stock_min > 0
      AND (
        NOT EXISTS (SELECT 1 FROM product_stocks s WHERE s.product_id = p.id)
        OR EXISTS (SELECT 1 FROM product_stocks s WHERE s.product_id = p.id AND s.quantity <= p.stock_min)
      )`;
  return rows.map((r) => r.id);
}

function toDto(p: ProductRow) {
  const stocks = p.stocks
    .filter((s) => !s.location.deletedAt)
    .map((s) => ({
      locationId: s.locationId,
      locationName: s.location.name,
      quantity: s.quantity,
    }));
  const { stocks: _raw, ...rest } = p;
  return {
    ...rest,
    stocks,
    stock: stocks.reduce((n, s) => n + s.quantity, 0),
    isLow:
      p.isActive &&
      p.stockMin > 0 &&
      (stocks.length === 0 || stocks.some((s) => s.quantity <= p.stockMin)),
  };
}
