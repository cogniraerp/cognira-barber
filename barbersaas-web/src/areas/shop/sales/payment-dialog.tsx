import { CalendarDays, CircleCheck, MessageCircle, Plus, Printer, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isApiError } from '@/api/errors';
import { useChargesControllerCreate, useSalesControllerCreate } from '@/api/generated/endpoints';
import type { ChargeDto, CreateSaleDto, SaleDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { cn, formatMoney } from '@/lib/utils';
import { METHOD, METHOD_ORDER, type Method } from '../cash/methods';
import { centsToInput, parseMoney } from '../inventory/money';
import { useShop } from '../shop-context';
import { useRefreshShop } from '../settings/shared-utils';
import { OnlineChargeDialog } from './online-charge';
import { Ticket } from './ticket';
import { whatsappTicketUrl } from './ticket-utils';

type PayLine = { method: Method; amount: string; reference: string; chargeId?: string };

/**
 * Pago: uno o varios métodos (pago mixto). En efectivo se escribe lo recibido y se calcula el
 * vuelto. Se confirma solo cuando los pagos suman exactamente el total.
 */
export function PaymentDialog({ total, body, prepaid, onClose, onPaid }: {
  total: number;
  /** Adelanto ya pagado en línea al reservar: entra como pago hecho y solo se cobra el resto. */
  prepaid?: { amountCents: number; chargeId: string };
  body: Omit<CreateSaleDto, 'payments'>;
  onClose: () => void;
  onPaid: (sale: SaleDto, changeCents: number) => void;
}) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [lines, setLines] = useState<PayLine[]>(() =>
    prepaid
      ? [
          { method: 'online', amount: centsToInput(prepaid.amountCents), reference: 'Adelanto', chargeId: prepaid.chargeId },
          ...(total > prepaid.amountCents ? [{ method: 'cash' as Method, amount: centsToInput(total - prepaid.amountCents), reference: '' }] : []),
        ]
      : [{ method: 'cash', amount: centsToInput(total), reference: '' }],
  );
  const [received, setReceived] = useState('');
  const create = useSalesControllerCreate();
  const shop = useShop();
  const methods: Method[] = shop.plan.features.onlinePayments ? [...METHOD_ORDER, 'online'] : METHOD_ORDER;
  const createCharge = useChargesControllerCreate();
  const [charging, setCharging] = useState<{ line: number; charge: ChargeDto } | null>(null);
  const amounts = lines.map((l) => parseMoney(l.amount));
  const paid = amounts.reduce<number>((n, a) => n + (a ?? 0), 0);
  const remaining = total - paid;
  const cashCents = lines.reduce((n, l, i) => n + (l.method === 'cash' ? (amounts[i] ?? 0) : 0), 0);
  const receivedCents = received ? parseMoney(received) : null;
  const change = cashCents > 0 && receivedCents !== null ? receivedCents - cashCents : 0;
  const invalid = amounts.some((a) => !a) || remaining !== 0 || (receivedCents !== null && receivedCents < cashCents) || lines.some((l) => l.method === 'online' && !l.chargeId);
  const set = (i: number, patch: Partial<PayLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pickMethod = (m: Method) => {
    // Un solo pago: cambia el método. Con varios: agrega una línea por lo que falta.
    if (lines.length === 1) return set(0, { method: m, chargeId: undefined });
    if (remaining > 0) setLines([...lines, { method: m, amount: centsToInput(remaining), reference: '' }]);
  };
  const err: unknown = create.error ?? createCharge.error;
  const startCharge = (i: number) =>
    createCharge.mutate(
      { data: { amountCents: amounts[i]!, description: `${shop.barbershop.name} · Cobro` } },
      { onSuccess: (charge) => setCharging({ line: i, charge }) },
    );

  const confirm = () => {
    create.mutate(
      { data: { ...body, payments: lines.map((l, i) => ({ method: l.method, amountCents: amounts[i]!, reference: l.reference.trim() || null, ...(l.chargeId ? { chargeId: l.chargeId } : {}) })) } },
      { onSuccess: async (sale) => { await refresh(); onPaid(sale, Math.max(0, change)); } },
    );
  };

  return (
    <Dialog open onClose={onClose} title={`Cobrar ${formatMoney(total)}`} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button size="lg" loading={create.isPending} disabled={invalid} onClick={confirm}>Confirmar pago</Button></>}>
      <div className="grid gap-4">
        {err ? <Alert title={isApiError(err) && err.problem.cashClosed ? 'La caja está cerrada: ábrela para cobrar.' : isApiError(err) && err.problem.noGateway ? 'Conecta tu pasarela en Configuración → Pagos en línea para cobrar con link o QR.' : errorMessage(err, t)} /> : null}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Método de pago">
          {methods.map((m) => {
            const M = METHOD[m];
            const active = lines.length === 1 && lines[0]!.method === m;
            return (
              <button key={m} type="button" onClick={() => pickMethod(m)} aria-pressed={active}
                className={cn('grid place-items-center gap-1 rounded-xl border p-3 text-sm font-medium transition', active ? 'border-marca-700 bg-marca-50 text-marca-800 ring-1 ring-marca-700' : 'border-slate-200 bg-white text-slate-700 hover:border-marca-300')}>
                <M.icon className="size-5" aria-hidden />{M.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-2">
          {lines.map((l, i) => {
            const M = METHOD[l.method];
            return (
              <div key={i} className="flex items-center gap-2">
                {lines.length > 1 && !l.chargeId ? (
                  // Pago mixto: cada línea elige su método (p. ej. efectivo + link/QR).
                  <Select aria-label={`Método del pago ${i + 1}`} className="h-10 w-36 shrink-0" value={l.method}
                    onChange={(e) => set(i, { method: e.target.value as Method, reference: '' })}>
                    {methods.map((m) => <option key={m} value={m}>{METHOD[m].label}</option>)}
                  </Select>
                ) : (
                  <span className="flex w-36 shrink-0 items-center gap-1.5 text-sm font-medium text-slate-700"><M.icon className="size-4 text-slate-400" aria-hidden />{M.label}</span>
                )}
                <Input aria-label={`Monto en ${M.label}`} inputMode="decimal" className="h-10 w-28 text-right tabular-nums" value={l.amount} readOnly={!!l.chargeId} onChange={(e) => set(i, { amount: e.target.value })} />
                {l.method === 'online' ? (
                  l.chargeId ? (
                    <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium text-emerald-700"><CircleCheck className="size-4 shrink-0" aria-hidden /><span className="truncate">Pagado{l.reference ? ` · ${l.reference}` : ''}</span></span>
                  ) : (
                    <Button size="sm" variant="outline" className="flex-1" loading={createCharge.isPending} disabled={!amounts[i]} onClick={() => startCharge(i)}><QrCode aria-hidden /> Generar link / QR</Button>
                  )
                ) : l.method !== 'cash' && <Input aria-label={`Referencia de ${M.label}`} placeholder="Nº operación" maxLength={60} className="h-10 min-w-0 flex-1" value={l.reference} onChange={(e) => set(i, { reference: e.target.value })} />}
                {lines.length > 1 && !l.chargeId && <Button variant="ghost" size="icon" className="ml-auto size-9 text-slate-400 hover:text-red-600" aria-label={`Quitar pago en ${M.label}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 aria-hidden /></Button>}
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm">
            <Button variant="link" className="h-auto px-0" disabled={remaining <= 0 && lines.length > 1}
              onClick={() => {
                // Dividir: la primera línea queda en la mitad y el resto va a Yape (editable).
                if (lines.length === 1) {
                  const half = Math.round(total / 2);
                  setLines([{ ...lines[0]!, amount: centsToInput(half) }, { method: lines[0]!.method === 'cash' ? 'yape' : 'cash', amount: centsToInput(total - half), reference: '' }]);
                } else setLines([...lines, { method: 'cash', amount: centsToInput(Math.max(0, remaining)), reference: '' }]);
              }}>
              <Plus aria-hidden /> {lines.length === 1 ? 'Pago mixto (dividir)' : 'Otro método'}
            </Button>
            <span className={cn('font-medium tabular-nums', remaining === 0 ? 'text-emerald-700' : 'text-amber-700')}>
              {remaining === 0 ? <><CircleCheck className="mr-1 inline size-4" aria-hidden />Pagos completos</> : remaining > 0 ? `Falta ${formatMoney(remaining)}` : `Sobra ${formatMoney(-remaining)}`}
            </span>
          </div>
        </div>

        {cashCents > 0 && (
          <div className="grid gap-2 rounded-xl bg-slate-50 p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
              Efectivo recibido
              <Input inputMode="decimal" placeholder={centsToInput(cashCents)} className="h-10 w-32 text-right text-base tabular-nums" value={received} onChange={(e) => setReceived(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[10, 20, 50, 100, 200].map((v) => v * 100 >= cashCents && <Button key={v} type="button" size="sm" variant="outline" onClick={() => setReceived(String(v))}>S/ {v}</Button>)}
            </div>
            {receivedCents !== null && (
              <p className={cn('flex justify-between text-base font-semibold', change < 0 ? 'text-red-700' : 'text-slate-900')}>
                <span>{change < 0 ? 'Falta' : 'Vuelto'}</span><span className="tabular-nums">{formatMoney(Math.abs(change))}</span>
              </p>
            )}
          </div>
        )}
      </div>
      {charging && (
        <OnlineChargeDialog initial={charging.charge} onClose={() => setCharging(null)}
          onPaid={(c) => { set(charging.line, { chargeId: c.id, reference: c.providerPaymentId ?? '', amount: centsToInput(c.amountCents) }); setCharging(null); }} />
      )}
    </Dialog>
  );
}

/** Venta cobrada: ticket con vuelto, imprimir, WhatsApp y siguiente venta. */
export function SuccessDialog({ sale, changeCents, fromAppointment, onNew }: { sale: SaleDto; changeCents: number; fromAppointment: boolean; onNew: () => void }) {
  const shop = useShop();
  return (
    <Dialog open onClose={onNew} title={`Venta ${sale.code} cobrada`} className="max-w-md"
      description={changeCents > 0 ? `Vuelto: ${formatMoney(changeCents)}` : undefined}
      footer={
        <>
          {fromAppointment && <Link to="../../agenda" relative="path" className={buttonVariants({ variant: 'ghost', className: 'mr-auto' })}><CalendarDays aria-hidden /> Agenda</Link>}
          <Button onClick={onNew}>Nueva venta</Button>
        </>
      }>
      <div className="grid gap-4">
        <Ticket sale={sale} changeCents={changeCents} />
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer aria-hidden /> Imprimir</Button>
          <a href={whatsappTicketUrl(sale, shop.barbershop.name)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}><MessageCircle aria-hidden /> WhatsApp</a>
        </div>
      </div>
    </Dialog>
  );
}
