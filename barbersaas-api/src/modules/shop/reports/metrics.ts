import { eachLocalDate, utcToLocalDate, type LocalDate } from '../../availability/engine';

/**
 * Agregaciones puras de los reportes (sin I/O). Convenciones:
 *  - Ingresos = total cobrado − propinas (la propina es del barbero, no de la barbería).
 *  - El descuento general de la venta se prorratea entre sus ítems (el último absorbe el
 *    redondeo), así la suma por servicio/producto/barbero cuadra con los ingresos.
 *  - Propina: a quien se indicó; si no, al barbero del primer servicio (igual que comisiones).
 */

export interface SaleRow {
  createdAt: Date;
  customerId: string | null;
  discountCents: number;
  tipCents: number;
  totalCents: number;
  tipStaffId: string | null;
  items: Array<{
    kind: 'service' | 'product';
    serviceId: string | null;
    productId: string | null;
    staffId: string | null;
    name: string;
    quantity: number;
    /** Descuento propio del ítem (ya restado de totalCents). */
    discountCents: number;
    totalCents: number;
  }>;
  payments: Array<{ method: string; amountCents: number }>;
}

export interface AppointmentRow {
  staffId: string;
  customerId: string | null;
  status: string;
  startAt: Date;
  endAt: Date;
}

/** Importe neto de cada ítem tras prorratear el descuento general. */
export function netItemCents(sale: Pick<SaleRow, 'discountCents' | 'items'>): number[] {
  const subtotal = sale.items.reduce((n, i) => n + i.totalCents, 0);
  let remaining = sale.discountCents;
  return sale.items.map((it, idx) => {
    const share =
      idx === sale.items.length - 1
        ? remaining
        : subtotal
          ? Math.round((sale.discountCents * it.totalCents) / subtotal)
          : 0;
    remaining -= share;
    return it.totalCents - share;
  });
}

export function tipStaffOf(sale: Pick<SaleRow, 'tipStaffId' | 'items'>): string | null {
  return (
    sale.tipStaffId ?? sale.items.find((i) => i.kind === 'service' && i.staffId)?.staffId ?? null
  );
}

export const BOOKED_STATUSES = new Set([
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'no_show',
]);
const minutes = (a: AppointmentRow) => (a.endAt.getTime() - a.startAt.getTime()) / 60_000;

export interface Kpis {
  revenueCents: number;
  salesCount: number;
  avgTicketCents: number;
  tipCents: number;
  discountCents: number;
  serviceCents: number;
  productCents: number;
  servicesCount: number;
  productsCount: number;
  appointments: number;
  completed: number;
  noShows: number;
  canceled: number;
  bookedMin: number;
  scheduledMin: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
}

export function computeKpis(
  sales: SaleRow[],
  appts: AppointmentRow[],
  scheduledMin: number,
  customers: { total: number; new: number },
): Kpis {
  const k: Kpis = {
    revenueCents: 0,
    salesCount: sales.length,
    avgTicketCents: 0,
    tipCents: 0,
    discountCents: 0,
    serviceCents: 0,
    productCents: 0,
    servicesCount: 0,
    productsCount: 0,
    appointments: appts.filter((a) => a.status !== 'canceled').length,
    completed: appts.filter((a) => a.status === 'completed').length,
    noShows: appts.filter((a) => a.status === 'no_show').length,
    canceled: appts.filter((a) => a.status === 'canceled').length,
    bookedMin: Math.round(
      appts.filter((a) => BOOKED_STATUSES.has(a.status)).reduce((n, a) => n + minutes(a), 0),
    ),
    scheduledMin: Math.round(scheduledMin),
    customers: customers.total,
    newCustomers: customers.new,
    returningCustomers: customers.total - customers.new,
  };
  for (const s of sales) {
    k.revenueCents += s.totalCents - s.tipCents;
    k.tipCents += s.tipCents;
    k.discountCents += s.discountCents + s.items.reduce((n, i) => n + i.discountCents, 0);
    netItemCents(s).forEach((net, i) => {
      const it = s.items[i]!;
      if (it.kind === 'service') {
        k.serviceCents += net;
        k.servicesCount += it.quantity;
      } else {
        k.productCents += net;
        k.productsCount += it.quantity;
      }
    });
  }
  k.avgTicketCents = k.salesCount ? Math.round(k.revenueCents / k.salesCount) : 0;
  return k;
}

export function byDay(sales: SaleRow[], from: LocalDate, to: LocalDate, tz: string) {
  const days = new Map(
    [...eachLocalDate(from, to)].map((d) => [
      d,
      { date: d, revenueCents: 0, salesCount: 0, tipCents: 0 },
    ]),
  );
  for (const s of sales) {
    const d = days.get(utcToLocalDate(s.createdAt, tz));
    if (!d) continue;
    d.revenueCents += s.totalCents - s.tipCents;
    d.tipCents += s.tipCents;
    d.salesCount += 1;
  }
  return [...days.values()];
}

/** Por servicio o producto (agrupa por id; si se borró el catálogo, por nombre). */
export function byCatalog(sales: SaleRow[], kind: 'service' | 'product') {
  const m = new Map<
    string,
    { id: string | null; name: string; quantity: number; revenueCents: number }
  >();
  for (const s of sales)
    netItemCents(s).forEach((net, i) => {
      const it = s.items[i]!;
      if (it.kind !== kind) return;
      const id = kind === 'service' ? it.serviceId : it.productId;
      const key = id ?? `name:${it.name}`;
      const row = m.get(key) ?? { id, name: it.name, quantity: 0, revenueCents: 0 };
      row.quantity += it.quantity;
      row.revenueCents += net;
      m.set(key, row);
    });
  return [...m.values()].sort(
    (a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name),
  );
}

export function byMethod(sales: SaleRow[]) {
  const m = new Map<string, { method: string; count: number; amountCents: number }>();
  for (const s of sales)
    for (const p of s.payments) {
      const row = m.get(p.method) ?? { method: p.method, count: 0, amountCents: 0 };
      row.count += 1;
      row.amountCents += p.amountCents;
      m.set(p.method, row);
    }
  return [...m.values()].sort((a, b) => b.amountCents - a.amountCents);
}

export interface StaffRow {
  staffId: string;
  revenueCents: number;
  serviceCents: number;
  productCents: number;
  servicesCount: number;
  productsCount: number;
  tipCents: number;
  appointments: number;
  completed: number;
  noShows: number;
  bookedMin: number;
  scheduledMin: number;
}

export function byStaff(
  sales: SaleRow[],
  appts: AppointmentRow[],
  scheduled: Map<string, number>,
): StaffRow[] {
  const m = new Map<string, StaffRow>();
  const row = (id: string) => {
    let r = m.get(id);
    if (!r) {
      r = {
        staffId: id,
        revenueCents: 0,
        serviceCents: 0,
        productCents: 0,
        servicesCount: 0,
        productsCount: 0,
        tipCents: 0,
        appointments: 0,
        completed: 0,
        noShows: 0,
        bookedMin: 0,
        scheduledMin: Math.round(scheduled.get(id) ?? 0),
      };
      m.set(id, r);
    }
    return r;
  };
  for (const id of scheduled.keys()) row(id);
  for (const s of sales) {
    netItemCents(s).forEach((net, i) => {
      const it = s.items[i]!;
      if (!it.staffId) return;
      const r = row(it.staffId);
      r.revenueCents += net;
      if (it.kind === 'service') {
        r.serviceCents += net;
        r.servicesCount += it.quantity;
      } else {
        r.productCents += net;
        r.productsCount += it.quantity;
      }
    });
    const tipTo = s.tipCents > 0 ? tipStaffOf(s) : null;
    if (tipTo) row(tipTo).tipCents += s.tipCents;
  }
  for (const a of appts) {
    const r = row(a.staffId);
    if (a.status !== 'canceled') r.appointments += 1;
    if (a.status === 'completed') r.completed += 1;
    if (a.status === 'no_show') r.noShows += 1;
    if (BOOKED_STATUSES.has(a.status)) r.bookedMin += minutes(a);
  }
  for (const r of m.values()) r.bookedMin = Math.round(r.bookedMin);
  return [...m.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

/** Período anterior de igual duración, inmediatamente antes. */
export function previousPeriod(
  from: LocalDate,
  to: LocalDate,
): { from: LocalDate; to: LocalDate; days: number } {
  const DAY = 86_400_000;
  const f = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - f) / DAY) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { from: iso(f - days * DAY), to: iso(f - DAY), days };
}
