import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { pageArgs } from '../../../common/http/zod';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import type { CashMovementKind, PaymentMethod } from '../../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { resolveLocation } from '../inventory/inventory.service';
import {
  METHODS,
  type CloseShiftDto,
  type CreateCashMovementDto,
  type OpenShiftDto,
  type ShiftsQueryDto,
} from './cash.dto';

const IN: CashMovementKind[] = ['sale', 'income'];
const KIND_LABEL: Record<string, string> = {
  income: 'ingreso',
  expense: 'egreso',
  withdrawal: 'retiro',
};

type Movement = {
  id: string;
  kind: CashMovementKind;
  method: PaymentMethod;
  amountCents: number;
  concept: string;
  saleId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};
type ShiftRow = {
  id: string;
  openedAt: Date;
  openedByUserId: string;
  openingCents: number;
  closedAt: Date | null;
  closedByUserId: string | null;
  counted: unknown;
  differenceCents: number | null;
  notes: string | null;
  register: { id: string; name: string };
};

/**
 * Caja por sede. Un turno abierto por caja (índice único parcial). Los movimientos no se editan:
 * un error se corrige con otro movimiento. El cierre guarda lo esperado y lo contado por método.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  current(t: TenantContext, locationId?: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const reg = await registerFor(tx, t.barbershopId, locationId);
      const shift = await tx.cashShift.findFirst({
        where: { registerId: reg.id, closedAt: null },
        select: shiftSelect,
      });
      return {
        register: { id: reg.id, name: reg.name, locationName: reg.location.name },
        shift: shift ? await this.detail(tx, t, shift) : null,
      };
    });
  }

  open(t: TenantContext, dto: OpenShiftDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const reg = await registerFor(tx, t.barbershopId, dto.locationId);
      const already = await tx.cashShift.findFirst({
        where: { registerId: reg.id, closedAt: null },
        select: { id: true },
      });
      if (already)
        throw AppError.conflict('La caja ya está abierta', ErrorCode.CONFLICT, {
          shiftId: already.id,
        });
      let shift;
      try {
        shift = await tx.cashShift.create({
          data: {
            barbershopId: t.barbershopId,
            registerId: reg.id,
            openedByUserId: t.userId,
            openingCents: dto.openingCents,
            notes: dto.notes,
          },
          select: shiftSelect,
        });
      } catch (e) {
        // Dos aperturas simultáneas: el índice único deja pasar solo una.
        if (/cash_shifts_one_open_uq|P2002/.test(String(e)))
          throw AppError.conflict('La caja ya está abierta');
        throw e;
      }
      await this.audit.record(tx, {
        action: 'shop.cash.open',
        barbershopId: t.barbershopId,
        entity: 'cash_shift',
        entityId: shift.id,
        diff: { openingCents: dto.openingCents },
      });
      return this.detail(tx, t, shift);
    });
  }

  addMovement(t: TenantContext, dto: CreateCashMovementDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const shift = await lockOpenShift(tx, t.barbershopId, dto.locationId);
      if (dto.kind === 'withdrawal' && dto.method !== 'cash')
        throw AppError.conflict('Los retiros son de efectivo');
      if (dto.method === 'cash' && dto.kind !== 'income') {
        const available = await cashAvailable(tx, shift.id, shift.openingCents);
        if (dto.amountCents > available)
          throw AppError.conflict(
            `No hay suficiente efectivo en caja (hay ${(available / 100).toFixed(2)})`,
            ErrorCode.CONFLICT,
            { availableCents: available },
          );
      }
      await addCashMovement(tx, t, shift.id, {
        kind: dto.kind,
        method: dto.method,
        amountCents: dto.amountCents,
        concept: dto.concept,
      });
      await this.audit.record(tx, {
        action: `shop.cash.${dto.kind}`,
        barbershopId: t.barbershopId,
        entity: 'cash_shift',
        entityId: shift.id,
        diff: dto,
      });
      return this.detail(
        tx,
        t,
        await tx.cashShift.findUniqueOrThrow({ where: { id: shift.id }, select: shiftSelect }),
      );
    });
  }

  close(t: TenantContext, dto: CloseShiftDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const shift = await lockOpenShift(tx, t.barbershopId, dto.locationId);
      const movements = await tx.cashMovement.findMany({
        where: { shiftId: shift.id },
        select: movementSelect,
      });
      const expected = expectedByMethod(movements, shift.openingCents);
      const counted: Record<string, number> = {};
      let difference = 0;
      for (const m of METHODS) {
        const exp = expected[m] ?? 0;
        const c = dto.counted[m];
        if (c === undefined) {
          if (exp !== 0) counted[m] = exp; // no contado = se da por cuadrado
          continue;
        }
        counted[m] = c;
        difference += c - exp;
      }
      await tx.cashShift.update({
        where: { id: shift.id },
        data: {
          closedAt: new Date(),
          closedByUserId: t.userId,
          expected,
          counted,
          differenceCents: difference,
          notes: dto.notes ?? shift.notes,
        },
      });
      await this.audit.record(tx, {
        action: 'shop.cash.close',
        barbershopId: t.barbershopId,
        entity: 'cash_shift',
        entityId: shift.id,
        diff: { expected, counted, differenceCents: difference },
      });
      return this.detail(
        tx,
        t,
        await tx.cashShift.findUniqueOrThrow({ where: { id: shift.id }, select: shiftSelect }),
      );
    });
  }

  list(t: TenantContext, q: ShiftsQueryDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const where = {
        barbershopId: t.barbershopId,
        ...(q.locationId ? { register: { locationId: q.locationId } } : {}),
        ...(q.from || q.to
          ? {
              openedAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.cashShift.findMany({
          where,
          select: shiftSelect,
          orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
          ...pageArgs(q),
        }),
        tx.cashShift.count({ where }),
      ]);
      const movements = await tx.cashMovement.findMany({
        where: { shiftId: { in: rows.map((r) => r.id) } },
        select: { ...movementSelect, shiftId: true },
      });
      const names = await userNames(
        tx,
        t.barbershopId,
        rows.flatMap((r) => [r.openedByUserId, r.closedByUserId]),
      );
      return {
        items: rows.map((r) =>
          summarize(
            r,
            movements.filter((m) => m.shiftId === r.id),
            names,
          ),
        ),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const s = await tx.cashShift.findFirst({
        where: { id, barbershopId: t.barbershopId },
        select: shiftSelect,
      });
      if (!s) throw AppError.notFound('Turno de caja');
      return this.detail(tx, t, s);
    });
  }

  private async detail(tx: Tx, t: TenantContext, s: ShiftRow) {
    const movements = await tx.cashMovement.findMany({
      where: { shiftId: s.id },
      select: movementSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const names = await userNames(tx, t.barbershopId, [
      s.openedByUserId,
      s.closedByUserId,
      ...movements.map((m) => m.createdByUserId),
    ]);
    return {
      ...summarize(s, movements, names),
      movements: movements.map(({ createdByUserId, ...m }) => ({
        ...m,
        createdBy: createdByUserId ? (names.get(createdByUserId) ?? null) : null,
      })),
    };
  }
}

// ─────────────────────────── utilidades (también las usa el POS) ───────────────────────────

const shiftSelect = {
  id: true,
  openedAt: true,
  openedByUserId: true,
  openingCents: true,
  closedAt: true,
  closedByUserId: true,
  counted: true,
  differenceCents: true,
  notes: true,
  register: { select: { id: true, name: true } },
} as const;
const movementSelect = {
  id: true,
  kind: true,
  method: true,
  amountCents: true,
  concept: true,
  saleId: true,
  createdByUserId: true,
  createdAt: true,
} as const;

/** Caja de la sede (la principal si no se indica); se crea "Caja principal" la primera vez. */
export async function registerFor(tx: Tx, barbershopId: string, locationId?: string) {
  const loc = await resolveLocation(tx, barbershopId, locationId);
  const found = await tx.cashRegister.findFirst({
    where: { barbershopId, locationId: loc, deletedAt: null },
    select: { id: true, name: true, location: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (found) return found;
  return tx.cashRegister.create({
    data: { barbershopId, locationId: loc, name: 'Caja principal' },
    select: { id: true, name: true, location: { select: { name: true } } },
  });
}

/** Turno abierto de la sede, bloqueado para escribir (null si la caja está cerrada). */
export async function openShiftFor(tx: Tx, barbershopId: string, locationId?: string) {
  const reg = await registerFor(tx, barbershopId, locationId);
  const [row] = await tx.$queryRaw<
    Array<{ id: string; opening_cents: number; notes: string | null }>
  >`
    SELECT id, opening_cents, notes FROM cash_shifts WHERE register_id = ${reg.id}::uuid AND closed_at IS NULL FOR UPDATE`;
  return row ? { id: row.id, openingCents: row.opening_cents, notes: row.notes } : null;
}

async function lockOpenShift(tx: Tx, barbershopId: string, locationId?: string) {
  const s = await openShiftFor(tx, barbershopId, locationId);
  if (!s)
    throw new AppError(ErrorCode.CONFLICT, 409, 'La caja está cerrada: ábrela primero', {
      cashClosed: true,
    });
  return s;
}

export async function addCashMovement(
  tx: Tx,
  t: Pick<TenantContext, 'barbershopId' | 'userId'>,
  shiftId: string,
  m: {
    kind: CashMovementKind;
    method: PaymentMethod;
    amountCents: number;
    concept: string;
    saleId?: string | null;
  },
) {
  await tx.cashMovement.create({
    data: {
      barbershopId: t.barbershopId,
      shiftId,
      createdByUserId: t.userId,
      saleId: m.saleId ?? null,
      ...m,
    },
  });
}

async function cashAvailable(tx: Tx, shiftId: string, openingCents: number): Promise<number> {
  const movements = await tx.cashMovement.findMany({
    where: { shiftId, method: 'cash' },
    select: { kind: true, amountCents: true },
  });
  return movements.reduce(
    (n, m) => n + (IN.includes(m.kind) ? m.amountCents : -m.amountCents),
    openingCents,
  );
}

export function expectedByMethod(
  movements: Array<{ kind: CashMovementKind; method: PaymentMethod; amountCents: number }>,
  openingCents: number,
): Record<string, number> {
  const out: Record<string, number> = { cash: openingCents };
  for (const m of movements)
    out[m.method] = (out[m.method] ?? 0) + (IN.includes(m.kind) ? m.amountCents : -m.amountCents);
  return out;
}

function summarize(s: ShiftRow, movements: Movement[], names: Map<string, string | null>) {
  const exp = expectedByMethod(movements, s.openingCents);
  const counted = (s.counted ?? null) as Record<string, number> | null;
  const used = METHODS.filter((m) => m === 'cash' || movements.some((x) => x.method === m));
  const totals = used.map((method) => {
    const ins = movements
      .filter((x) => x.method === method && IN.includes(x.kind))
      .reduce((n, x) => n + x.amountCents, 0);
    const outs = movements
      .filter((x) => x.method === method && !IN.includes(x.kind))
      .reduce((n, x) => n + x.amountCents, 0);
    const c = counted ? (counted[method] ?? null) : null;
    return {
      method,
      inCents: ins,
      outCents: outs,
      expectedCents: exp[method] ?? 0,
      countedCents: c,
      differenceCents: c === null ? null : c - (exp[method] ?? 0),
    };
  });
  const status: 'open' | 'closed' = s.closedAt ? 'closed' : 'open';
  return {
    id: s.id,
    status,
    register: s.register,
    openedAt: s.openedAt,
    openedBy: names.get(s.openedByUserId) ?? null,
    openingCents: s.openingCents,
    closedAt: s.closedAt,
    closedBy: s.closedByUserId ? (names.get(s.closedByUserId) ?? null) : null,
    notes: s.notes,
    totals,
    totalInCents: totals.reduce((n, x) => n + x.inCents, 0),
    totalOutCents: totals.reduce((n, x) => n + x.outCents, 0),
    differenceCents: s.differenceCents,
    movementsCount: movements.length,
  };
}

/** Nombre visible de usuarios de la barbería (usuarios es una tabla global: se lee vía memberships). */
async function userNames(
  tx: Tx,
  barbershopId: string,
  ids: Array<string | null>,
): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await tx.membership.findMany({
    where: { barbershopId, userId: { in: uniq } },
    select: { userId: true, user: { select: { fullName: true, email: true } } },
  });
  return new Map(rows.map((r) => [r.userId!, r.user?.fullName ?? r.user?.email ?? null]));
}

export const cashKindLabel = (k: string) => KIND_LABEL[k] ?? k;
