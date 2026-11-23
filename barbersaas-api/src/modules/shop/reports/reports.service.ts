import { Injectable } from '@nestjs/common';
import { toCsv } from '../../../common/http/csv';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import {
  eachLocalDate,
  localToUtc,
  totalMinutes,
  workingIntervals,
  type LocalDate,
} from '../../availability/engine';
import { loadSchedules } from '../../availability/schedule-loader';
import { badRequest } from '../shop-helpers';
import {
  byCatalog,
  byDay,
  byMethod,
  byStaff,
  computeKpis,
  previousPeriod,
  type AppointmentRow,
  type SaleRow,
} from './metrics';
import { MAX_REPORT_DAYS, type ReportExportQueryDto, type ReportQueryDto } from './reports.dto';

const DAY = 86_400_000;
const nextDay = (d: LocalDate) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/**
 * Reportes del negocio: ventas (cobradas, sin anuladas), citas, clientes y ocupación de la agenda.
 * Las fechas son días locales de la barbería; se compara con el período anterior de igual duración.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  overview(t: TenantContext, q: ReportQueryDto) {
    const days = [...eachLocalDate(q.from, q.to)].length;
    if (days < 1) throw badRequest('to', 'El rango de fechas es inválido');
    if (days > MAX_REPORT_DAYS) throw badRequest('to', `Máximo ${MAX_REPORT_DAYS} días`);
    const prev = previousPeriod(q.from, q.to);

    return this.prisma.run(tenantDb(t), async (tx) => {
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { timezone: true },
      });
      const locations = await tx.location.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true, isPrimary: true, timezone: true },
      });
      if (q.locationId && !locations.some((l) => l.id === q.locationId))
        throw badRequest('locationId', 'Sede inexistente');
      const tz = shop.timezone;
      const primaryId = (locations.find((l) => l.isPrimary) ?? locations[0])?.id;

      const staff = (
        await tx.staff.findMany({
          where: { barbershopId: t.barbershopId, deletedAt: null },
          select: {
            id: true,
            displayName: true,
            isActive: true,
            locationId: true,
            customHours: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
        })
      )
        .map((s) => ({ ...s, locationId: s.locationId ?? primaryId ?? '' }))
        .filter((s) => !q.locationId || s.locationId === q.locationId);

      const [cur, before] = [
        await this.period(tx, t, q.from, q.to, tz, q.locationId),
        await this.period(tx, t, prev.from, prev.to, tz, q.locationId),
      ];
      // Ocupación: horario de trabajo de los barberos activos (rango de ambos períodos de una vez).
      const working = staff.filter((s) => s.isActive && s.locationId);
      const sched = await loadSchedules(tx, {
        barbershopId: t.barbershopId,
        staff: working,
        tzOf: (id) => locations.find((l) => l.id === id)?.timezone ?? tz,
        from: prev.from,
        to: q.to,
      });
      const scheduled = (from: LocalDate, to: LocalDate) => {
        const m = new Map<string, number>();
        for (const s of working) {
          const loc = sched.locations.get(s.locationId)!;
          const st = sched.staff.get(s.id)!;
          let n = 0;
          for (const d of eachLocalDate(from, to)) n += totalMinutes(workingIntervals(loc, st, d));
          m.set(s.id, n);
        }
        return m;
      };
      const curSched = scheduled(q.from, q.to);
      const prevSched = scheduled(prev.from, prev.to);
      const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

      const names = new Map(staff.map((s) => [s.id, s.displayName]));
      const missing = [
        ...new Set(cur.sales.flatMap((s) => s.items.map((i) => i.staffId)).filter(Boolean)),
      ].filter((id) => !names.has(id!)) as string[];
      if (missing.length)
        for (const s of await tx.staff.findMany({
          where: { id: { in: missing } },
          select: { id: true, displayName: true },
        }))
          names.set(s.id, s.displayName);

      // Adelantos cobrados en el período (por fecha de pago) y en qué terminaron.
      const deps = await tx.appointmentDeposit.findMany({
        where: {
          barbershopId: t.barbershopId,
          paidAt: {
            gte: new Date(localToUtc(q.from, 0, tz)),
            lt: new Date(localToUtc(nextDay(q.to), 0, tz)),
          },
          ...(q.locationId ? { appointment: { locationId: q.locationId } } : {}),
        },
        select: { status: true, amountCents: true },
      });
      const sumOf = (...st: string[]) =>
        deps.filter((d) => st.includes(d.status)).reduce((n, d) => n + d.amountCents, 0);
      const deposits = {
        count: deps.length,
        paidCents: sumOf('paid', 'applied', 'retained', 'refund_pending', 'refunded'),
        appliedCents: sumOf('applied'),
        unusedCents: sumOf('paid'),
        retainedCents: sumOf('retained'),
        refundPendingCents: sumOf('refund_pending'),
        refundedCents: sumOf('refunded'),
      };

      return {
        timezone: tz,
        period: { from: q.from, to: q.to, days },
        deposits,
        previous: { from: prev.from, to: prev.to },
        kpis: computeKpis(cur.sales, cur.appts, sum(curSched), cur.customers),
        previousKpis: computeKpis(before.sales, before.appts, sum(prevSched), before.customers),
        byDay: byDay(cur.sales, q.from, q.to, tz),
        byStaff: byStaff(cur.sales, cur.appts, curSched)
          .filter((r) => names.has(r.staffId))
          .map(({ staffId, ...r }) => ({
            staff: { id: staffId, displayName: names.get(staffId)! },
            ...r,
          })),
        byService: byCatalog(cur.sales, 'service'),
        byProduct: byCatalog(cur.sales, 'product'),
        byMethod: byMethod(cur.sales) as Array<{
          method: 'cash' | 'yape' | 'plin' | 'card' | 'transfer' | 'other' | 'online';
          count: number;
          amountCents: number;
        }>,
      };
    });
  }

  /** Ventas, citas y clientes de un período. */
  private async period(
    tx: Tx,
    t: TenantContext,
    from: LocalDate,
    to: LocalDate,
    tz: string,
    locationId?: string,
  ) {
    const start = new Date(localToUtc(from, 0, tz));
    const end = new Date(localToUtc(nextDay(to), 0, tz));
    const where = { barbershopId: t.barbershopId, ...(locationId ? { locationId } : {}) };
    const [sales, appts] = await Promise.all([
      tx.sale.findMany({
        where: { ...where, status: 'completed', createdAt: { gte: start, lt: end } },
        select: {
          createdAt: true,
          customerId: true,
          discountCents: true,
          tipCents: true,
          totalCents: true,
          tipStaffId: true,
          items: {
            select: {
              kind: true,
              serviceId: true,
              productId: true,
              staffId: true,
              name: true,
              quantity: true,
              discountCents: true,
              totalCents: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
          payments: { select: { method: true, amountCents: true } },
        },
      }),
      tx.appointment.findMany({
        where: { ...where, deletedAt: null, startAt: { gte: start, lt: end } },
        select: { staffId: true, customerId: true, status: true, startAt: true, endAt: true },
      }),
    ]);

    // Clientes atendidos: con venta cobrada o cita completada. Nuevo = primera visita en el período.
    const ids = [
      ...new Set(
        [
          ...sales.map((s) => s.customerId),
          ...appts.filter((a) => a.status === 'completed').map((a) => a.customerId),
        ].filter((x): x is string => !!x),
      ),
    ];
    let isNew = 0;
    if (ids.length) {
      const [firstSale, firstAppt] = await Promise.all([
        tx.sale.groupBy({
          by: ['customerId'],
          where: { barbershopId: t.barbershopId, status: 'completed', customerId: { in: ids } },
          _min: { createdAt: true },
        }),
        tx.appointment.groupBy({
          by: ['customerId'],
          where: {
            barbershopId: t.barbershopId,
            status: 'completed',
            deletedAt: null,
            customerId: { in: ids },
          },
          _min: { startAt: true },
        }),
      ]);
      const first = new Map<string, number>();
      const keep = (id: string | null, d: Date | null) => {
        if (!id || !d) return;
        first.set(id, Math.min(first.get(id) ?? Infinity, d.getTime()));
      };
      for (const r of firstSale) keep(r.customerId, r._min.createdAt);
      for (const r of firstAppt) keep(r.customerId, r._min.startAt);
      isNew = ids.filter((id) => (first.get(id) ?? 0) >= start.getTime()).length;
    }

    return {
      sales: sales as SaleRow[],
      appts: appts as AppointmentRow[],
      customers: { total: ids.length, new: isNew },
    };
  }

  /** CSV (Excel) de una sección del reporte. Montos en soles con 2 decimales. */
  async exportCsv(t: TenantContext, q: ReportExportQueryDto): Promise<string> {
    const r = await this.overview(t, q);
    const soles = (c: number) => (c / 100).toFixed(2);
    const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : '');
    switch (q.section) {
      case 'days':
        return toCsv(
          ['fecha', 'ventas', 'ingresos', 'propinas'],
          r.byDay.map((d) => [d.date, d.salesCount, soles(d.revenueCents), soles(d.tipCents)]),
        );
      case 'staff':
        return toCsv(
          [
            'barbero',
            'ingresos',
            'servicios',
            'importe_servicios',
            'productos',
            'importe_productos',
            'propinas',
            'citas',
            'completadas',
            'no_asistio',
            'min_reservados',
            'min_programados',
            'ocupacion_pct',
          ],
          r.byStaff.map((s) => [
            s.staff.displayName,
            soles(s.revenueCents),
            s.servicesCount,
            soles(s.serviceCents),
            s.productsCount,
            soles(s.productCents),
            soles(s.tipCents),
            s.appointments,
            s.completed,
            s.noShows,
            s.bookedMin,
            s.scheduledMin,
            pct(s.bookedMin, s.scheduledMin),
          ]),
        );
      case 'services':
      case 'products':
        return toCsv(
          [q.section === 'services' ? 'servicio' : 'producto', 'cantidad', 'ingresos'],
          (q.section === 'services' ? r.byService : r.byProduct).map((x) => [
            x.name,
            x.quantity,
            soles(x.revenueCents),
          ]),
        );
      case 'methods':
        return toCsv(
          ['metodo', 'pagos', 'importe'],
          r.byMethod.map((m) => [m.method, m.count, soles(m.amountCents)]),
        );
    }
  }
}
