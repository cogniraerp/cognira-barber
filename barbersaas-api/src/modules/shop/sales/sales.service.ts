import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { pageArgs } from '../../../common/http/zod';
import { can, tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import type { Prisma } from '../../../generated/prisma/client';
import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { maskPhone } from '../../appointments/appointment-view';
import { TRANSITIONS } from '../../appointments/booking.service';
import { applyStatus } from '../../appointments/shop-appointments.controller';
import { addCashMovement, openShiftFor } from '../cash/cash.service';
import { move, resolveLocation } from '../inventory/inventory.service';
import { recordSaleCommissions, reverseSaleCommissions } from '../commissions/commissions.service';
import { onDepositAppliedToSale, onDepositSaleVoided } from '../../deposits/deposits';
import { claimCharge } from '../../payments/charges.service';
import { requestRefund } from '../../payments/refunds';
import { saleCode } from './sale-code';
import type { CreateSaleDto, ListSalesQueryDto, VoidSaleDto } from './sales.dto';

const saleSelect = {
  id: true,
  number: true,
  status: true,
  createdAt: true,
  createdByUserId: true,
  appointmentId: true,
  subtotalCents: true,
  discountCents: true,
  tipCents: true,
  totalCents: true,
  notes: true,
  voidedAt: true,
  voidedByUserId: true,
  voidReason: true,
  tipStaffId: true,
  customer: { select: { id: true, fullName: true, phoneE164: true } },
  items: {
    select: {
      id: true,
      kind: true,
      serviceId: true,
      productId: true,
      name: true,
      quantity: true,
      unitPriceCents: true,
      discountCents: true,
      totalCents: true,
      staff: { select: { id: true, displayName: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  payments: { select: { method: true, amountCents: true, reference: true } },
} as const satisfies Prisma.SaleSelect;
type SaleRow = Prisma.SaleGetPayload<{ select: typeof saleSelect }>;

/**
 * Punto de venta. Una venta se registra entera en UNA transacción: correlativo, ítems, pagos,
 * stock (movimientos de venta), caja (movimientos "sale" por método) y la cita como completada.
 * No se edita: se anula (con motivo), revirtiendo stock y caja.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  create(t: TenantContext, dto: CreateSaleDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { currency: true },
      });
      const locationId = await resolveLocation(tx, t.barbershopId, dto.locationId);
      const shift = await openShiftFor(tx, t.barbershopId, locationId);
      if (!shift)
        throw new AppError(ErrorCode.CONFLICT, 409, 'La caja está cerrada: ábrela para cobrar', {
          cashClosed: true,
        });

      // Cita: misma barbería, cobrable y sin otra venta vigente.
      let customerId = dto.customerId;
      if (dto.appointmentId) {
        const a = await tx.appointment.findFirst({
          where: { id: dto.appointmentId, barbershopId: t.barbershopId, deletedAt: null },
          select: { id: true, status: true, customerId: true, staffId: true },
        });
        if (!a) throw AppError.notFound('Cita');
        if (a.status === 'canceled' || a.status === 'no_show')
          throw AppError.conflict('Esta cita no se puede cobrar (cancelada o no asistió)');
        const paid = await tx.sale.findFirst({
          where: { appointmentId: a.id, status: 'completed' },
          select: { number: true },
        });
        if (paid)
          throw AppError.conflict(
            `Esta cita ya se cobró (${saleCode(paid.number)})`,
            ErrorCode.CONFLICT,
            { saleNumber: paid.number },
          );
        if (
          !can(t, 'appointments.manage_all') &&
          !(can(t, 'appointments.manage_own') && a.staffId === t.staffId)
        )
          throw AppError.forbidden('No puedes cobrar citas de otro barbero');
        customerId = customerId ?? a.customerId;
        await completeAppointment(tx, a.id, a.status, a.customerId);
      }
      if (customerId) {
        const c = await tx.customer.findFirst({
          where: { id: customerId, barbershopId: t.barbershopId, deletedAt: null },
          select: { id: true },
        });
        if (!c) throw AppError.notFound('Cliente');
      }

      // Precios: servicio → precio del barbero (si tiene) o del servicio; producto → del catálogo.
      const items = [];
      for (const [i, it] of dto.items.entries()) {
        if (it.staffId) await assertStaff(tx, t.barbershopId, it.staffId);
        let name: string;
        let price: number;
        if (it.kind === 'service') {
          const sv = await tx.service.findFirst({
            where: { id: it.serviceId!, barbershopId: t.barbershopId, deletedAt: null },
            select: { name: true, priceCents: true },
          });
          if (!sv) throw AppError.notFound('Servicio');
          const own = it.staffId
            ? await tx.staffService.findFirst({
                where: { staffId: it.staffId, serviceId: it.serviceId! },
                select: { priceCentsOverride: true },
              })
            : null;
          name = sv.name;
          price = it.unitPriceCents ?? own?.priceCentsOverride ?? sv.priceCents;
        } else {
          const p = await tx.product.findFirst({
            where: { id: it.productId!, barbershopId: t.barbershopId, deletedAt: null },
            select: { name: true, priceCents: true, isActive: true },
          });
          if (!p || !p.isActive) throw AppError.notFound('Producto');
          name = p.name;
          price = it.unitPriceCents ?? p.priceCents;
        }
        const gross = price * it.quantity;
        if (it.discountCents > gross)
          throw badRequest(`items.${i}.discountCents`, 'El descuento supera el importe');
        items.push({
          ...it,
          name,
          unitPriceCents: price,
          totalCents: gross - it.discountCents,
          sortOrder: i,
        });
      }
      const subtotal = items.reduce((n, x) => n + x.totalCents, 0);
      if (dto.discountCents > subtotal)
        throw badRequest('discountCents', 'El descuento supera el subtotal');
      const total = subtotal - dto.discountCents + dto.tipCents;
      const paid = dto.payments.reduce((n, p) => n + p.amountCents, 0);
      if (paid !== total)
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Los pagos (${(paid / 100).toFixed(2)}) no suman el total (${(total / 100).toFixed(2)})`,
          { totalCents: total, paidCents: paid },
        );
      if (dto.tipStaffId) await assertStaff(tx, t.barbershopId, dto.tipStaffId);
      // Pagos en línea: el cobro debe estar pagado, sin usar y por el monto exacto (bloqueado).
      const payments = [];
      for (const p of dto.payments) {
        if (!p.chargeId) {
          payments.push(p);
          continue;
        }
        const c = await claimCharge(tx, t.barbershopId, p.chargeId, p.amountCents);
        payments.push({ ...p, reference: p.reference ?? c.providerPaymentId });
      }

      // Correlativo sin huecos: UPDATE … RETURNING bloquea la fila de settings hasta el commit.
      await tx.barbershopSettings.upsert({
        where: { barbershopId: t.barbershopId },
        create: { barbershopId: t.barbershopId },
        update: {},
      });
      const [counter] = await tx.$queryRaw<Array<{ last_sale_number: number }>>`
        UPDATE barbershop_settings SET last_sale_number = last_sale_number + 1 WHERE barbershop_id = ${t.barbershopId}::uuid RETURNING last_sale_number`;
      const number = counter!.last_sale_number;

      const sale = await tx.sale.create({
        data: {
          barbershopId: t.barbershopId,
          locationId,
          shiftId: shift.id,
          number,
          customerId,
          appointmentId: dto.appointmentId,
          subtotalCents: subtotal,
          discountCents: dto.discountCents,
          tipCents: dto.tipCents,
          tipStaffId: dto.tipStaffId,
          totalCents: total,
          notes: dto.notes,
          createdByUserId: t.userId,
          items: {
            create: items.map((x) => ({
              barbershopId: t.barbershopId,
              kind: x.kind,
              serviceId: x.serviceId ?? null,
              productId: x.productId ?? null,
              staffId: x.staffId,
              name: x.name,
              quantity: x.quantity,
              unitPriceCents: x.unitPriceCents,
              discountCents: x.discountCents,
              totalCents: x.totalCents,
              sortOrder: x.sortOrder,
            })),
          },
          payments: {
            create: payments.map((p) => ({
              barbershopId: t.barbershopId,
              method: p.method,
              amountCents: p.amountCents,
              reference: p.reference,
            })),
          },
        },
        select: { id: true },
      });
      for (const x of items.filter((i) => i.kind === 'product')) {
        await move(tx, t, {
          productId: x.productId!,
          locationId,
          kind: 'sale',
          quantity: -x.quantity,
          saleId: sale.id,
          note: saleCode(number),
        });
      }
      for (const p of payments.filter((x) => x.chargeId)) {
        await tx.paymentCharge.update({ where: { id: p.chargeId }, data: { saleId: sale.id } });
        // Si era el adelanto de la cita, queda aplicado a esta venta.
        await onDepositAppliedToSale(tx, p.chargeId!, sale.id);
      }
      for (const p of payments) {
        await addCashMovement(tx, t, shift.id, {
          kind: 'sale',
          method: p.method,
          amountCents: p.amountCents,
          concept: `Venta ${saleCode(number)}`,
          saleId: sale.id,
        });
      }
      await recordSaleCommissions(tx, t.barbershopId, sale.id);
      await this.audit.record(tx, {
        action: 'shop.sale.create',
        barbershopId: t.barbershopId,
        entity: 'sale',
        entityId: sale.id,
        diff: { number, totalCents: total, appointmentId: dto.appointmentId },
      });
      return this.load(tx, t, sale.id, shop.currency);
    });
  }

  /** Anular: devuelve el stock y registra la devolución en la caja abierta (por método). */
  void(t: TenantContext, id: string, dto: VoidSaleDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{ status: string; number: number; location_id: string }>
      >`
        SELECT status, number, location_id FROM sales WHERE id = ${id}::uuid AND barbershop_id = ${t.barbershopId}::uuid FOR UPDATE`;
      if (!row) throw AppError.notFound('Venta');
      if (row.status === 'voided') throw AppError.conflict('La venta ya está anulada');
      const shift = await openShiftFor(tx, t.barbershopId, row.location_id);
      if (!shift)
        throw new AppError(ErrorCode.CONFLICT, 409, 'Abre la caja para registrar la devolución', {
          cashClosed: true,
        });
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id },
        select: {
          items: { select: { kind: true, productId: true, quantity: true } },
          payments: { select: { method: true, amountCents: true } },
        },
      });
      // Lo cobrado en línea (QR o adelanto) se devuelve por la pasarela (lo ejecuta el worker).
      const charges = await tx.paymentCharge.findMany({
        where: { saleId: id, status: 'paid' },
        select: { id: true, deposit: { select: { id: true } } },
      });
      for (const c of charges)
        await requestRefund(tx, c.id, `Venta ${saleCode(row.number)} anulada`, {
          saleId: id,
          depositId: c.deposit?.id,
        });
      for (const it of sale.items.filter((i) => i.kind === 'product')) {
        await move(tx, t, {
          productId: it.productId!,
          locationId: row.location_id,
          kind: 'return',
          quantity: it.quantity,
          saleId: id,
          note: `Anulación ${saleCode(row.number)}`,
        });
      }
      for (const p of sale.payments) {
        await addCashMovement(tx, t, shift.id, {
          kind: 'refund',
          method: p.method,
          amountCents: p.amountCents,
          concept: `Anulación ${saleCode(row.number)}`,
          saleId: id,
        });
      }
      await reverseSaleCommissions(tx, t.barbershopId, id);
      await tx.sale.update({
        where: { id },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          voidedByUserId: t.userId,
          voidReason: dto.reason,
        },
      });
      await onDepositSaleVoided(tx, id);
      await this.audit.record(tx, {
        action: 'shop.sale.void',
        barbershopId: t.barbershopId,
        entity: 'sale',
        entityId: id,
        diff: { reason: dto.reason },
      });
      return this.load(tx, t, id);
    });
  }

  get(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const s = await this.load(tx, t, id);
      this.assertCanView(t, s);
      return s;
    });
  }

  list(t: TenantContext, q: ListSalesQueryDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const n = q.q ? Number(q.q.replace(/^v-?/i, '')) : NaN;
      const where: Prisma.SaleWhereInput = {
        barbershopId: t.barbershopId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.method ? { payments: { some: { method: q.method } } } : {}),
        ...(q.staffId ? { items: { some: { staffId: q.staffId } } } : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
        ...(q.q
          ? Number.isInteger(n) && n > 0
            ? { number: n }
            : { customer: { fullName: { contains: q.q, mode: 'insensitive' } } }
          : {}),
        // Sin "ver todas": solo las ventas que registró o donde atendió.
        ...(can(t, 'sales.view_all')
          ? {}
          : {
              OR: [
                { createdByUserId: t.userId },
                ...(t.staffId ? [{ items: { some: { staffId: t.staffId } } }] : []),
              ],
            }),
      };
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { currency: true },
      });
      const [rows, total, agg] = await Promise.all([
        tx.sale.findMany({
          where,
          select: saleSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...pageArgs(q),
        }),
        tx.sale.count({ where }),
        tx.sale.aggregate({
          where: { ...where, status: 'completed' },
          _sum: { totalCents: true, tipCents: true },
          _count: { _all: true },
        }),
      ]);
      const names = await this.names(tx, t, rows);
      return {
        items: rows.map((r) => this.toDto(t, r, shop.currency, names)),
        total,
        page: q.page,
        pageSize: q.pageSize,
        summary: {
          count: agg._count._all,
          totalCents: agg._sum.totalCents ?? 0,
          tipCents: agg._sum.tipCents ?? 0,
        },
      };
    });
  }

  private assertCanView(
    t: TenantContext,
    s: { createdByUserId?: string | null; items: Array<{ staff: { id: string } | null }> } & {
      createdBy: string | null;
    },
  ) {
    void s;
    if (!can(t, 'sales.view_all') && !can(t, 'sales.create')) throw AppError.forbidden();
  }

  private async load(tx: Tx, t: TenantContext, id: string, currency?: string) {
    const r = await tx.sale.findFirst({
      where: { id, barbershopId: t.barbershopId },
      select: saleSelect,
    });
    if (!r) throw AppError.notFound('Venta');
    const cur =
      currency ??
      (
        await tx.barbershop.findUniqueOrThrow({
          where: { id: t.barbershopId },
          select: { currency: true },
        })
      ).currency;
    return this.toDto(t, r, cur, await this.names(tx, t, [r]));
  }

  private async names(tx: Tx, t: TenantContext, rows: SaleRow[]) {
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.createdByUserId, r.voidedByUserId]).filter((x): x is string => !!x),
      ),
    ];
    const staffIds = [...new Set(rows.map((r) => r.tipStaffId).filter((x): x is string => !!x))];
    const [users, staff] = await Promise.all([
      userIds.length
        ? tx.membership.findMany({
            where: { barbershopId: t.barbershopId, userId: { in: userIds } },
            select: { userId: true, user: { select: { fullName: true, email: true } } },
          })
        : [],
      staffIds.length
        ? tx.staff.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, displayName: true },
          })
        : [],
    ]);
    return {
      users: new Map(users.map((u) => [u.userId!, u.user?.fullName ?? u.user?.email ?? null])),
      staff: new Map(staff.map((s) => [s.id, s])),
    };
  }

  private toDto(
    t: TenantContext,
    r: SaleRow,
    currency: string,
    names: {
      users: Map<string, string | null>;
      staff: Map<string, { id: string; displayName: string }>;
    },
  ) {
    const showContact = can(t, 'customers.view_contact');
    return {
      id: r.id,
      number: r.number,
      code: saleCode(r.number),
      status: r.status,
      createdAt: r.createdAt,
      createdBy: r.createdByUserId ? (names.users.get(r.createdByUserId) ?? null) : null,
      customer: r.customer
        ? {
            id: r.customer.id,
            fullName: r.customer.fullName,
            phone: r.customer.phoneE164
              ? showContact
                ? r.customer.phoneE164
                : maskPhone(r.customer.phoneE164)
              : null,
          }
        : null,
      appointmentId: r.appointmentId,
      items: r.items,
      payments: r.payments,
      subtotalCents: r.subtotalCents,
      discountCents: r.discountCents,
      tipCents: r.tipCents,
      tipStaff: r.tipStaffId ? (names.staff.get(r.tipStaffId) ?? null) : null,
      totalCents: r.totalCents,
      currency,
      notes: r.notes,
      voidedAt: r.voidedAt,
      voidedBy: r.voidedByUserId ? (names.users.get(r.voidedByUserId) ?? null) : null,
      voidReason: r.voidReason,
    };
  }
}

/** Lleva la cita a "completada" respetando las transiciones (pendiente → confirmada → completada). */
async function completeAppointment(
  tx: Tx,
  id: string,
  status: AppointmentStatus,
  customerId: string | null,
) {
  if (status === 'completed') return;
  let from = status;
  if (!TRANSITIONS[from].includes('completed')) {
    await applyStatus(tx, id, from, 'confirmed', undefined, customerId);
    from = 'confirmed';
  }
  await applyStatus(tx, id, from, 'completed', undefined, customerId);
}

async function assertStaff(tx: Tx, barbershopId: string, staffId: string) {
  const s = await tx.staff.findFirst({
    where: { id: staffId, barbershopId, deletedAt: null },
    select: { id: true },
  });
  if (!s) throw AppError.notFound('Barbero');
}

function badRequest(path: string, message: string) {
  return new AppError(ErrorCode.VALIDATION_FAILED, 400, message, { errors: [{ path, message }] });
}
