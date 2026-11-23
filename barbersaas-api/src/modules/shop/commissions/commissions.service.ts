import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { pageArgs } from '../../../common/http/zod';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { addCashMovement, openShiftFor } from '../cash/cash.service';
import { saleCode } from '../sales/sale-code';
import type {
  CommissionConfigDto,
  CreatePayoutDto,
  EntriesQueryDto,
  PayoutsQueryDto,
} from './commissions.dto';
import { computeEntries, readConfig, type Rule } from './rules';

/**
 * Comisiones: se generan al cobrar (por ítem atendido + propina), se revierten al anular (entradas
 * negativas) y se pagan en liquidaciones que agrupan todo lo pendiente hasta una fecha.
 */
@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  getConfig(t: TenantContext, staffId: string) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      readConfig((await findStaff(tx, t.barbershopId, staffId)).commission),
    );
  }

  setConfig(t: TenantContext, staffId: string, dto: CommissionConfigDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findStaff(tx, t.barbershopId, staffId);
      const ids = dto.overrides.map((o) => o.serviceId);
      if (ids.length) {
        const n = await tx.service.count({
          where: { id: { in: ids }, barbershopId: t.barbershopId, deletedAt: null },
        });
        if (n !== new Set(ids).size) throw AppError.notFound('Servicio');
      }
      await tx.staff.update({
        where: { id: staffId },
        data: { commission: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonObject },
      });
      await this.audit.record(tx, {
        action: 'shop.commission.config',
        barbershopId: t.barbershopId,
        entity: 'staff',
        entityId: staffId,
        diff: dto,
      });
      return readConfig(dto);
    });
  }

  summary(t: TenantContext, from: string, to: string, onlyStaffId?: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const staff = await tx.staff.findMany({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          ...(onlyStaffId ? { id: onlyStaffId } : { isActive: true }),
        },
        select: { id: true, displayName: true, commission: true },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      });
      const ids = staff.map((s) => s.id);
      const [period, pending, last] = await Promise.all([
        tx.commissionEntry.findMany({
          where: {
            barbershopId: t.barbershopId,
            staffId: { in: ids },
            earnedAt: { gte: new Date(from), lt: new Date(to) },
          },
          select: {
            staffId: true,
            kind: true,
            baseCents: true,
            amountCents: true,
            reversalOfId: true,
          },
        }),
        tx.commissionEntry.groupBy({
          by: ['staffId'],
          where: { barbershopId: t.barbershopId, staffId: { in: ids }, payoutId: null },
          _sum: { amountCents: true },
        }),
        tx.commissionPayout.groupBy({
          by: ['staffId'],
          where: { barbershopId: t.barbershopId, staffId: { in: ids } },
          _max: { createdAt: true },
        }),
      ]);
      const rows = staff.map((s) => {
        const mine = period.filter((e) => e.staffId === s.id);
        const sum = (f: (e: (typeof mine)[number]) => boolean, k: 'amountCents' | 'baseCents') =>
          mine.filter(f).reduce((n, e) => n + e[k], 0);
        const commission = sum((e) => e.kind !== 'tip', 'amountCents');
        const tips = sum((e) => e.kind === 'tip', 'amountCents');
        return {
          staff: { id: s.id, displayName: s.displayName },
          servicesCount:
            mine.filter((e) => e.kind === 'service' && !e.reversalOfId).length -
            mine.filter((e) => e.kind === 'service' && e.reversalOfId).length,
          productsCount:
            mine.filter((e) => e.kind === 'product' && !e.reversalOfId).length -
            mine.filter((e) => e.kind === 'product' && e.reversalOfId).length,
          baseCents: sum((e) => e.kind !== 'tip', 'baseCents'),
          commissionCents: commission,
          tipCents: tips,
          earnedCents: commission + tips,
          pendingCents: pending.find((p) => p.staffId === s.id)?._sum.amountCents ?? 0,
          lastPayoutAt: last.find((p) => p.staffId === s.id)?._max.createdAt ?? null,
          config: readConfig(s.commission),
        };
      });
      return {
        rows,
        totals: {
          earnedCents: rows.reduce((n, r) => n + r.earnedCents, 0),
          pendingCents: rows.reduce((n, r) => n + r.pendingCents, 0),
          tipCents: rows.reduce((n, r) => n + r.tipCents, 0),
        },
      };
    });
  }

  entries(t: TenantContext, q: EntriesQueryDto, onlyStaffId?: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const where: Prisma.CommissionEntryWhereInput = {
        barbershopId: t.barbershopId,
        ...(onlyStaffId ? { staffId: onlyStaffId } : q.staffId ? { staffId: q.staffId } : {}),
        ...(q.status ? { payoutId: q.status === 'paid' ? { not: null } : null } : {}),
        ...(q.from || q.to
          ? {
              earnedAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.commissionEntry.findMany({
          where,
          select: entrySelect,
          orderBy: [{ earnedAt: 'desc' }, { createdAt: 'desc' }],
          ...pageArgs(q),
        }),
        tx.commissionEntry.count({ where }),
      ]);
      return { items: await withSaleCodes(tx, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  createPayout(t: TenantContext, dto: CreatePayoutDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const staff = await findStaff(tx, t.barbershopId, dto.staffId);
      // Bloquea las entradas pendientes para que dos liquidaciones simultáneas no paguen lo mismo.
      const to = dto.to ? new Date(dto.to) : new Date();
      const pending = await tx.$queryRaw<Array<{ id: string; amount_cents: number }>>`
        SELECT id, amount_cents FROM commission_entries
        WHERE barbershop_id = ${t.barbershopId}::uuid AND staff_id = ${dto.staffId}::uuid AND payout_id IS NULL AND earned_at < ${to}
        FOR UPDATE`;
      if (!pending.length) throw AppError.conflict('No hay comisiones pendientes para liquidar');
      const total = pending.reduce((n, e) => n + e.amount_cents, 0);
      if (total <= 0)
        throw AppError.conflict(
          'El saldo pendiente es cero o negativo (hay anulaciones por descontar)',
        );
      if (dto.registerInCash) {
        if (dto.method !== 'cash')
          throw AppError.conflict('Solo los pagos en efectivo salen de la caja');
        const shift = await openShiftFor(tx, t.barbershopId);
        if (!shift)
          throw new AppError(
            ErrorCode.CONFLICT,
            409,
            'La caja está cerrada: ábrela o desmarca "registrar en caja"',
            { cashClosed: true },
          );
        await addCashMovement(tx, t, shift.id, {
          kind: 'expense',
          method: 'cash',
          amountCents: total,
          concept: `Pago de comisiones a ${staff.displayName}`,
        });
      }
      const payout = await tx.commissionPayout.create({
        data: {
          barbershopId: t.barbershopId,
          staffId: dto.staffId,
          periodTo: to,
          totalCents: total,
          entriesCount: pending.length,
          method: dto.method,
          note: dto.note,
          createdByUserId: t.userId,
        },
        select: { id: true },
      });
      await tx.commissionEntry.updateMany({
        where: { id: { in: pending.map((e) => e.id) } },
        data: { payoutId: payout.id },
      });
      await this.audit.record(tx, {
        action: 'shop.commission.payout',
        barbershopId: t.barbershopId,
        entity: 'commission_payout',
        entityId: payout.id,
        diff: { staffId: dto.staffId, totalCents: total, entries: pending.length },
      });
      return (await this.payoutRows(tx, t, { id: payout.id }))[0]!;
    });
  }

  payouts(t: TenantContext, q: PayoutsQueryDto, onlyStaffId?: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const where = {
        barbershopId: t.barbershopId,
        ...(onlyStaffId ? { staffId: onlyStaffId } : q.staffId ? { staffId: q.staffId } : {}),
      };
      const [items, total] = await Promise.all([
        this.payoutRows(tx, t, where, pageArgs(q)),
        tx.commissionPayout.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  async me(t: TenantContext, from: string, to: string) {
    if (!t.staffId) throw AppError.forbidden('Tu usuario no tiene perfil de barbero');
    const { rows } = await this.summary(t, from, to, t.staffId);
    const entries = await this.entries(t, { page: 1, pageSize: 100, from, to }, t.staffId);
    const payouts = await this.payouts(t, { page: 1, pageSize: 5 }, t.staffId);
    return { summary: rows[0]!, entries: entries.items, payouts: payouts.items };
  }

  private async payoutRows(
    tx: Tx,
    t: TenantContext,
    where: Prisma.CommissionPayoutWhereInput,
    page?: { skip: number; take: number },
  ) {
    const rows = await tx.commissionPayout.findMany({
      where,
      select: {
        id: true,
        periodTo: true,
        totalCents: true,
        entriesCount: true,
        method: true,
        note: true,
        createdAt: true,
        createdByUserId: true,
        staff: { select: { id: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(page ?? {}),
    });
    const userIds = [
      ...new Set(rows.map((r) => r.createdByUserId).filter((x): x is string => !!x)),
    ];
    const users = userIds.length
      ? await tx.membership.findMany({
          where: { barbershopId: t.barbershopId, userId: { in: userIds } },
          select: { userId: true, user: { select: { fullName: true, email: true } } },
        })
      : [];
    const names = new Map(users.map((u) => [u.userId!, u.user?.fullName ?? u.user?.email ?? null]));
    return rows.map(({ createdByUserId, ...r }) => ({
      ...r,
      createdBy: createdByUserId ? (names.get(createdByUserId) ?? null) : null,
    }));
  }
}

// ─────────────────────── enganche con el POS (misma transacción de la venta) ───────────────────────

/** Genera las comisiones de una venta recién creada. */
export async function recordSaleCommissions(
  tx: Tx,
  barbershopId: string,
  saleId: string,
): Promise<void> {
  const sale = await tx.sale.findUniqueOrThrow({
    where: { id: saleId },
    select: {
      createdAt: true,
      discountCents: true,
      tipCents: true,
      tipStaffId: true,
      items: {
        select: {
          id: true,
          kind: true,
          serviceId: true,
          staffId: true,
          name: true,
          quantity: true,
          totalCents: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  const staffIds = [
    ...new Set(
      [...sale.items.map((i) => i.staffId), sale.tipStaffId].filter((x): x is string => !!x),
    ),
  ];
  if (!staffIds.length) return;
  const staff = await tx.staff.findMany({
    where: { id: { in: staffIds }, barbershopId },
    select: { id: true, commission: true },
  });
  const drafts = computeEntries(sale, new Map(staff.map((s) => [s.id, readConfig(s.commission)])));
  if (!drafts.length) return;
  await tx.commissionEntry.createMany({
    data: drafts.map((d) => ({
      barbershopId,
      saleId,
      earnedAt: sale.createdAt,
      ...d,
    })),
  });
}

/** Al anular: una entrada negativa por cada una vigente (si ya se pagó, se descuenta en la próxima liquidación). */
export async function reverseSaleCommissions(
  tx: Tx,
  barbershopId: string,
  saleId: string,
): Promise<void> {
  const entries = await tx.commissionEntry.findMany({
    where: { saleId, barbershopId, reversalOfId: null },
  });
  if (!entries.length) return;
  const now = new Date();
  await tx.commissionEntry.createMany({
    data: entries.map((e) => ({
      barbershopId,
      saleId,
      staffId: e.staffId,
      saleItemId: e.saleItemId,
      kind: e.kind,
      description: `Anulación: ${e.description}`,
      baseCents: -e.baseCents,
      rule: e.rule as Rule,
      amountCents: -e.amountCents,
      earnedAt: now,
      reversalOfId: e.id,
    })),
  });
}

const entrySelect = {
  id: true,
  kind: true,
  description: true,
  baseCents: true,
  rule: true,
  amountCents: true,
  earnedAt: true,
  saleId: true,
  reversalOfId: true,
  payoutId: true,
  staff: { select: { id: true, displayName: true } },
} as const satisfies Prisma.CommissionEntrySelect;

async function withSaleCodes(
  tx: Tx,
  rows: Array<Prisma.CommissionEntryGetPayload<{ select: typeof entrySelect }>>,
) {
  const sales = await tx.sale.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.saleId))] } },
    select: { id: true, number: true },
  });
  const num = new Map(sales.map((s) => [s.id, s.number]));
  return rows.map(({ reversalOfId, ...r }) => {
    const status: 'paid' | 'pending' = r.payoutId ? 'paid' : 'pending';
    return {
      ...r,
      rule: readRule(r.rule),
      saleCode: saleCode(num.get(r.saleId) ?? 0),
      isReversal: !!reversalOfId,
      status,
    };
  });
}

function readRule(raw: unknown): Rule {
  const r = raw as Rule | null;
  return r && (r.type === 'percent' || r.type === 'fixed') && typeof r.value === 'number'
    ? r
    : { type: 'percent', value: 0 };
}

async function findStaff(tx: Tx, barbershopId: string, id: string) {
  const s = await tx.staff.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: { id: true, displayName: true, commission: true },
  });
  if (!s) throw AppError.notFound('Barbero');
  return s;
}
