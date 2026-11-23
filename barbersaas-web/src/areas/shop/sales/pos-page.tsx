import { CalendarCheck, Clock, Lock, Minus, Plus, Search, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  useCashControllerCurrent,
  useCustomersControllerList,
  useInventoryControllerList,
  useServicesControllerList,
  useShopAppointmentsControllerGet,
  useStaffControllerList,
} from '@/api/generated/endpoints';
import type { AppointmentDto, SaleDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/table';
import { formatTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { useDebounced } from '@/lib/use-debounced';
import { cn, formatMoney } from '@/lib/utils';
import { OpenDialog } from '../cash/cash-dialogs';
import { parseMoney } from '../inventory/money';
import { useCan, useShop } from '../shop-context';
import { PaymentDialog, SuccessDialog } from './payment-dialog';

export type Line = {
  key: string;
  kind: 'service' | 'product';
  serviceId?: string;
  productId?: string;
  name: string;
  staffId: string | null;
  quantity: number;
  unitPriceCents: number;
  /** Stock disponible (productos). */
  max?: number;
};
type Customer = { id: string; fullName: string; phone: string | null };

/**
 * Punto de venta: catálogo (servicios y productos) a la izquierda y ticket a la derecha.
 * `?cita=<id>` precarga la cita (servicios, barbero y cliente) para cobrarla.
 */
export function PosPage() {
  const [sp] = useSearchParams();
  const citaId = sp.get('cita');
  const appt = useShopAppointmentsControllerGet(citaId ?? '', { query: { enabled: !!citaId } });
  if (citaId && !appt.data && !appt.error) return <div className="p-6"><Skeleton className="h-96" /></div>;
  // Se monta de nuevo al cambiar de cita, con su estado inicial (sin copiar estado en efectos).
  return <Pos key={citaId ?? 'libre'} appointment={appt.data ?? null} />;
}

function Pos({ appointment }: { appointment: AppointmentDto | null }) {
  const shop = useShop();
  const can = useCan();
  const navigate = useNavigate();
  const tz = shop.barbershop.timezone;
  const services = useServicesControllerList({});
  const staff = useStaffControllerList({});
  const canSeeProducts = can(['products.manage', 'inventory.manage', 'cash.manage']);
  const products = useInventoryControllerList({ status: 'active', pageSize: 100 }, { query: { enabled: canSeeProducts } });
  const cash = useCashControllerCurrent({}, { query: { enabled: can('cash.manage') } });

  const ownStaff = shop.staffId;
  const fromAppt = (a: AppointmentDto): Line[] =>
    a.items.map((i, k) => ({ key: `a${k}`, kind: 'service', serviceId: i.serviceId, name: i.name, staffId: a.staff.id, quantity: 1, unitPriceCents: i.priceCents }));
  const [lines, setLines] = useState<Line[]>(() => (appointment ? fromAppt(appointment) : []));
  // Adelanto pagado al reservar: se usa como pago en línea (una sola vez).
  const prepaid = appointment?.deposit?.status === 'paid' && appointment.deposit.chargeId ? { amountCents: appointment.deposit.amountCents, chargeId: appointment.deposit.chargeId } : undefined;
  const [customer, setCustomer] = useState<Customer | null>(() => (appointment?.customer ? { id: appointment.customer.id, fullName: appointment.customer.fullName, phone: appointment.customer.phone } : null));
  const [discount, setDiscount] = useState('');
  const [tip, setTip] = useState('');
  const [tipStaffId, setTipStaffId] = useState<string>('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'service' | 'product'>('service');
  const [dialog, setDialog] = useState<'pay' | 'open' | null>(null);
  const [done, setDone] = useState<{ sale: SaleDto; change: number } | null>(null);

  const activeStaff = (staff.data ?? []).filter((s) => s.isActive);
  const servicePrice = (serviceId: string, staffId: string | null) => {
    const sv = services.data?.find((s) => s.id === serviceId);
    const own = staffId ? sv?.staff.find((x) => x.staffId === staffId) : undefined;
    return own?.priceCents ?? sv?.priceCents ?? 0;
  };
  const addService = (id: string) => {
    const sv = services.data!.find((s) => s.id === id)!;
    const staffId = ownStaff ?? lines.find((l) => l.kind === 'service')?.staffId ?? null;
    setLines([...lines, { key: crypto.randomUUID(), kind: 'service', serviceId: id, name: sv.name, staffId, quantity: 1, unitPriceCents: servicePrice(id, staffId) }]);
  };
  const addProduct = (id: string) => {
    const p = products.data!.items.find((x) => x.id === id)!;
    const existing = lines.find((l) => l.productId === id);
    if (existing) return setLines(lines.map((l) => (l === existing ? { ...l, quantity: Math.min(l.quantity + 1, p.stock) } : l)));
    setLines([...lines, { key: crypto.randomUUID(), kind: 'product', productId: id, name: p.name, staffId: ownStaff, quantity: 1, unitPriceCents: p.priceCents, max: p.stock }]);
  };
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const needle = q.trim().toLowerCase();
  const svcList = (services.data ?? []).filter((s) => s.isActive && (!needle || s.name.toLowerCase().includes(needle)));
  const prodList = (products.data?.items ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle) || p.barcode === q.trim());

  const subtotal = lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0);
  const discountCents = discount ? parseMoney(discount) : 0;
  const tipCents = tip ? parseMoney(tip) : 0;
  const total = subtotal - (discountCents ?? 0) + (tipCents ?? 0);
  const invalid = !lines.length || discountCents === null || tipCents === null || (discountCents ?? 0) > subtotal;
  const cashClosed = can('cash.manage') && cash.data && !cash.data.shift;
  const defaultTipStaff = tipStaffId || lines.find((l) => l.staffId)?.staffId || '';

  const body = {
    appointmentId: appointment?.id ?? null,
    customerId: customer?.id ?? null,
    items: lines.map((l) => ({
      kind: l.kind,
      ...(l.serviceId ? { serviceId: l.serviceId } : {}),
      ...(l.productId ? { productId: l.productId } : {}),
      staffId: l.staffId,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
    })),
    discountCents: discountCents ?? 0,
    tipCents: tipCents ?? 0,
    tipStaffId: tipCents ? defaultTipStaff || null : null,
  };
  const reset = () => {
    setDone(null);
    if (appointment) navigate('.', { replace: true });
    setLines([]);
    setCustomer(null);
    setDiscount('');
    setTip('');
    setTipStaffId('');
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Cobrar" subtitle="Servicios y productos, descuento, propina y pago mixto." />
      {cashClosed && (
        <Alert title="La caja está cerrada">
          <span className="flex flex-wrap items-center gap-2">Ábrela para poder cobrar. <Button size="sm" onClick={() => setDialog('open')}><Lock aria-hidden /> Abrir caja</Button></span>
        </Alert>
      )}
      {appointment && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-marca-200 bg-marca-50/60 px-4 py-3 text-sm">
          <CalendarCheck className="size-5 text-marca-700" aria-hidden />
          <span className="flex-1">
            Cobrando la cita de <strong>{appointment.customer?.fullName ?? 'Walk-in'}</strong> · {formatTime(appointment.startAt, tz)} con {appointment.staff.displayName}
          </span>
          {appointment.saleId && <Badge tone="warning">Esta cita ya fue cobrada</Badge>}
          {prepaid && <Badge tone="success">Adelanto pagado {formatMoney(prepaid.amountCents)}: solo se cobra el resto</Badge>}
          <Link to="." replace className={buttonVariants({ variant: 'ghost', size: 'sm' })}><X aria-hidden /> Venta libre</Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        {/* Catálogo */}
        <section className="grid content-start gap-3" aria-label="Catálogo">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Buscar</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input className="pl-9" placeholder={tab === 'service' ? 'Buscar servicio' : 'Nombre, SKU o código de barras (Enter agrega)'} value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const first = tab === 'product' ? prodList.find((p) => p.stock > 0) : undefined;
                  const svc = tab === 'service' ? svcList[0] : undefined;
                  if (first) addProduct(first.id);
                  else if (svc) addService(svc.id);
                  setQ('');
                }} />
            </label>
            <div role="tablist" aria-label="Catálogo" className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              {(['service', 'product'] as const).filter((k) => k === 'service' || canSeeProducts).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn('rounded-md px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-marca-700 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                  {k === 'service' ? 'Servicios' : 'Productos'}
                </button>
              ))}
            </div>
          </div>
          {tab === 'service' ? (
            !services.data ? <Skeleton className="h-64" /> : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {svcList.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => addService(s.id)} className="grid h-full w-full gap-1 rounded-2xl border border-slate-200/80 bg-white p-4 text-left transition hover:border-marca-300 hover:shadow-sm">
                      <span className="font-medium text-slate-900">{s.name}</span>
                      <span className="flex items-center gap-1 text-xs text-slate-500"><Clock className="size-3" aria-hidden />{s.durationMin} min</span>
                      <span className="font-semibold text-marca-700 tabular-nums">{formatMoney(s.priceCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : !products.data ? <Skeleton className="h-64" /> : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {prodList.map((p) => {
                const inTicket = lines.find((l) => l.productId === p.id)?.quantity ?? 0;
                const out = p.stock - inTicket <= 0;
                return (
                  <li key={p.id}>
                    <button type="button" disabled={out} onClick={() => addProduct(p.id)} className="grid h-full w-full gap-1 rounded-2xl border border-slate-200/80 bg-white p-4 text-left transition hover:border-marca-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
                      <span className="font-medium text-slate-900">{p.name}</span>
                      <span className="text-xs text-slate-500">{p.stock <= 0 ? 'Agotado' : `Stock ${p.stock - inTicket}`}</span>
                      <span className="font-semibold text-marca-700 tabular-nums">{formatMoney(p.priceCents)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Ticket */}
        <section className="grid content-start gap-3 lg:sticky lg:top-4 lg:self-start" aria-label="Ticket">
          <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <CustomerField value={customer} onChange={setCustomer} locked={!!appointment?.customer} />
            {lines.length === 0 ? (
              <p className="grid place-items-center gap-2 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                <ShoppingBag className="size-6 text-slate-400" aria-hidden />Toca un servicio o producto para agregarlo.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <li key={l.key} className="grid gap-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-900">{l.name}</span>
                      <span className="flex items-center gap-1">
                        <span className="font-semibold tabular-nums">{formatMoney(l.unitPriceCents * l.quantity)}</span>
                        <Button variant="ghost" size="icon" className="size-8 text-slate-400 hover:text-red-600" aria-label={`Quitar ${l.name}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 aria-hidden /></Button>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select aria-label={`Barbero de ${l.name}`} className={cn('h-9 min-w-0 flex-1 text-sm', l.kind === 'service' && !l.staffId && 'border-amber-400 bg-amber-50/60')} value={l.staffId ?? ''}
                        onChange={(e) => {
                          const staffId = e.target.value || null;
                          update(l.key, { staffId, ...(l.kind === 'service' && l.serviceId && !appointment ? { unitPriceCents: servicePrice(l.serviceId, staffId) } : {}) });
                        }}>
                        <option value="">{l.kind === 'service' ? 'Sin barbero' : 'Sin vendedor'}</option>
                        {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                      </Select>
                      {l.kind === 'product' && (
                        <span className="flex items-center rounded-lg border border-slate-200">
                          <button type="button" className="grid size-9 place-items-center text-slate-500 hover:bg-slate-50 disabled:opacity-40" disabled={l.quantity <= 1} aria-label={`Menos ${l.name}`} onClick={() => update(l.key, { quantity: l.quantity - 1 })}><Minus className="size-4" aria-hidden /></button>
                          <span className="w-8 text-center text-sm font-medium tabular-nums" aria-live="polite">{l.quantity}</span>
                          <button type="button" className="grid size-9 place-items-center text-slate-500 hover:bg-slate-50 disabled:opacity-40" disabled={l.max !== undefined && l.quantity >= l.max} aria-label={`Más ${l.name}`} onClick={() => update(l.key, { quantity: l.quantity + 1 })}><Plus className="size-4" aria-hidden /></button>
                        </span>
                      )}
                    </div>
                    {l.kind === 'service' && !l.staffId && <p className="text-xs text-amber-700">Elige quién atendió: sin barbero no suma a sus comisiones.</p>}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <label className="grid gap-1 text-sm"><span className="text-slate-500">Descuento (S/)</span>
                <Input inputMode="decimal" placeholder="0.00" className="h-10 tabular-nums" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-invalid={discountCents === null || (discountCents ?? 0) > subtotal || undefined} />
              </label>
              <label className="grid gap-1 text-sm"><span className="text-slate-500">Propina (S/)</span>
                <Input inputMode="decimal" placeholder="0.00" className="h-10 tabular-nums" value={tip} onChange={(e) => setTip(e.target.value)} aria-invalid={tipCents === null || undefined} />
              </label>
            </div>
            {(tipCents ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-500">Propina para
                <Select aria-label="Propina para" className="h-9 flex-1 text-sm" value={defaultTipStaff} onChange={(e) => setTipStaffId(e.target.value)}>
                  <option value="">Sin asignar</option>
                  {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                </Select>
              </label>
            )}
            <dl className="grid gap-1 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between text-slate-500"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(subtotal)}</dd></div>
              {(discountCents ?? 0) > 0 && <div className="flex justify-between text-slate-500"><dt>Descuento</dt><dd className="tabular-nums">−{formatMoney(discountCents!)}</dd></div>}
              {(tipCents ?? 0) > 0 && <div className="flex justify-between text-slate-500"><dt>Propina</dt><dd className="tabular-nums">{formatMoney(tipCents!)}</dd></div>}
              <div className="flex justify-between text-lg font-semibold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{formatMoney(Math.max(0, total))}</dd></div>
            </dl>
            <Button size="lg" className="h-12 text-base" disabled={invalid || !!cashClosed || !!appointment?.saleId} onClick={() => setDialog('pay')}>
              Cobrar {formatMoney(Math.max(0, total))}
            </Button>
          </div>
        </section>
      </div>

      {dialog === 'open' && <OpenDialog onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PaymentDialog total={total} body={body} prepaid={prepaid} onClose={() => setDialog(null)} onPaid={(sale, change) => { setDialog(null); setDone({ sale, change }); }} />}
      {done && <SuccessDialog sale={done.sale} changeCents={done.change} fromAppointment={!!appointment} onNew={reset} />}
    </div>
  );
}

/** Cliente de la venta (opcional): busca en el CRM. */
function CustomerField({ value, onChange, locked }: { value: Customer | null; onChange: (c: Customer | null) => void; locked: boolean }) {
  const can = useCan();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const found = useCustomersControllerList({ q: dq, pageSize: 5 }, { query: { enabled: can('customers.view') && dq.length >= 2 } });
  const items = useMemo(() => found.data?.items ?? [], [found.data]);
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
        <UserRound className="size-4 text-slate-400" aria-hidden />
        <span className="grid min-w-0 flex-1"><span className="truncate font-medium text-slate-900">{value.fullName}</span>{value.phone && <span className="text-xs text-slate-500 tabular-nums">{formatPhone(value.phone)}</span>}</span>
        {!locked && <Button variant="ghost" size="icon" className="size-8" aria-label="Quitar cliente" onClick={() => onChange(null)}><X aria-hidden /></Button>}
      </div>
    );
  }
  if (!can('customers.view')) return <p className="text-sm text-slate-500">Venta sin cliente.</p>;
  return (
    <div className="relative">
      <label className="relative block">
        <span className="sr-only">Cliente</span>
        <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input className="h-10 pl-9" placeholder="Cliente (opcional): nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {dq.length >= 2 && dq === q.trim() && items.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className="grid w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onChange({ id: c.id, fullName: c.fullName, phone: c.phone }); setQ(''); }}>
                <span className="font-medium text-slate-900">{c.fullName}</span>
                <span className="text-xs text-slate-500 tabular-nums">{formatPhone(c.phone) ?? 'Sin teléfono'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
