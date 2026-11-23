import { CircleCheck, CircleMinus, CirclePlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { useCashControllerAddMovement, useCashControllerClose, useCashControllerOpen } from '@/api/generated/endpoints';
import type { CurrentCashDtoShift } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { cn, formatMoney } from '@/lib/utils';
import { saved, useRefreshShop } from '../settings/shared-utils';
import { centsToInput, parseMoney } from '../inventory/money';
import { CONCEPTS, METHOD, METHOD_ORDER, type Method } from './methods';

export function OpenDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const open = useCashControllerOpen({ mutation: { onSuccess: async () => { await refresh(); saved('Caja abierta'); onClose(); } } });
  const cents = parseMoney(amount || '0');
  return (
    <Dialog open onClose={onClose} title="Abrir caja" description="Cuenta el efectivo con el que empiezas el día (el sencillo para dar vuelto)."
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button type="submit" form="open-cash" loading={open.isPending} disabled={cents === null}>Abrir caja</Button></>}>
      <form id="open-cash" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (cents !== null) open.mutate({ data: { openingCents: cents, notes: notes.trim() || null } }); }}>
        {open.error ? <Alert title={errorMessage(open.error, t)} /> : null}
        <Field label="Fondo inicial (S/)" error={amount && cents === null ? 'Monto inválido' : undefined}>
          {(p) => <Input {...p} autoFocus inputMode="decimal" placeholder="0.00" className="text-lg tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          {[50, 100, 200, 300].map((v) => <Button key={v} type="button" size="sm" variant="outline" onClick={() => setAmount(String(v))}>S/ {v}</Button>)}
        </div>
        <Field label="Nota (opcional)">{(p) => <Input {...p} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </form>
    </Dialog>
  );
}

const MOVE_TITLE = { income: 'Registrar ingreso', expense: 'Registrar egreso', withdrawal: 'Retirar efectivo' } as const;

export function CashMovementDialog({ kind, cashAvailable, onClose }: { kind: 'income' | 'expense' | 'withdrawal'; cashAvailable: number; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [f, setF] = useState({ amount: '', method: 'cash' as Method, concept: '' });
  const add = useCashControllerAddMovement({ mutation: { onSuccess: async () => { await refresh(); saved(`${MOVE_TITLE[kind].replace('Registrar ', '').replace('Retirar efectivo', 'Retiro')} registrado`); onClose(); } } });
  const cents = parseMoney(f.amount);
  const err: unknown = add.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};
  const tooMuch = kind !== 'income' && f.method === 'cash' && cents !== null && cents > cashAvailable;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (cents) add.mutate({ data: { kind, method: kind === 'withdrawal' ? 'cash' : f.method, amountCents: cents, concept: f.concept.trim() } });
  };
  return (
    <Dialog open onClose={onClose} title={MOVE_TITLE[kind]}
      description={kind === 'withdrawal' ? `Sale efectivo de la caja. Disponible: ${formatMoney(cashAvailable)}.` : kind === 'expense' ? 'Un gasto pagado con dinero de la caja.' : 'Dinero que entra a la caja sin ser una venta.'}
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button type="submit" form="cash-move" loading={add.isPending} disabled={!cents || tooMuch || f.concept.trim().length < 2}>Registrar</Button></>}>
      <form id="cash-move" className="grid gap-4" onSubmit={submit}>
        {err && !Object.keys(fe).length ? <Alert title={errorMessage(err, t)} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monto (S/)" error={fe.amountCents ?? (tooMuch ? `Solo hay ${formatMoney(cashAvailable)} en efectivo` : f.amount && !cents ? 'Monto inválido' : undefined)}>
            {(p) => <Input {...p} autoFocus inputMode="decimal" placeholder="0.00" className="tabular-nums" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}
          </Field>
          {kind !== 'withdrawal' && (
            <Field label="Método">
              {(p) => (
                <Select {...p} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as Method })}>
                  {METHOD_ORDER.map((m) => <option key={m} value={m}>{METHOD[m].label}</option>)}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Concepto" error={fe.concept}>
          {(p) => (
            <>
              <Input {...p} list={`concepts-${kind}`} required minLength={2} maxLength={160} placeholder={CONCEPTS[kind][0]} value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} />
              <datalist id={`concepts-${kind}`}>{CONCEPTS[kind].map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Cierre con arqueo: por cada método, lo esperado contra lo contado. El efectivo se cuenta
 * siempre; Yape/tarjeta/etc. se revisan en su app (si coinciden, se dejan como están).
 */
export function CloseDialog({ shift, onClose }: { shift: NonNullable<CurrentCashDtoShift>; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [counted, setCounted] = useState<Record<string, string>>(() =>
    Object.fromEntries(shift.totals.map((x) => [x.method, x.method === 'cash' ? '' : centsToInput(x.expectedCents)])),
  );
  const [notes, setNotes] = useState('');
  const close = useCashControllerClose({
    mutation: {
      onSuccess: async (r) => {
        await refresh();
        const d = r.differenceCents ?? 0;
        saved(d === 0 ? 'Caja cerrada: todo cuadra' : d < 0 ? `Caja cerrada con faltante de ${formatMoney(-d)}` : `Caja cerrada con sobrante de ${formatMoney(d)}`);
        onClose();
      },
    },
  });
  const rows = shift.totals.map((x) => {
    const c = counted[x.method] === '' ? null : parseMoney(counted[x.method] ?? '');
    return { ...x, c, diff: c === null ? null : c - x.expectedCents };
  });
  const cash = rows.find((r) => r.method === 'cash');
  const invalid = rows.some((r) => counted[r.method] !== '' && r.c === null) || !cash || cash.c === null;
  const total = rows.reduce((n, r) => n + (r.diff ?? 0), 0);
  const submit = () => {
    const data: Record<string, number> = {};
    for (const r of rows) if (r.c !== null) data[r.method] = r.c;
    close.mutate({ data: { counted: data as { cash: number }, notes: notes.trim() || null } });
  };
  return (
    <Dialog open onClose={onClose} title="Cerrar caja" className="max-w-xl"
      description="Cuenta el efectivo del cajón y revisa en sus apps los cobros con Yape, Plin o tarjeta."
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button loading={close.isPending} disabled={invalid} onClick={submit}>Cerrar caja</Button></>}>
      <div className="grid gap-4">
        {close.error ? <Alert title={errorMessage(close.error, t)} /> : null}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr><th className="px-3 py-2 text-left">Método</th><th className="px-3 py-2 text-right">Esperado</th><th className="px-3 py-2 text-right">Contado</th><th className="px-3 py-2 text-right">Diferencia</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const M = METHOD[r.method as Method];
                return (
                  <tr key={r.method}>
                    <td className="px-3 py-2"><span className="flex items-center gap-2 font-medium text-slate-900"><M.icon className="size-4 text-slate-500" aria-hidden />{M.label}</span></td>
                    <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{formatMoney(r.expectedCents)}</td>
                    <td className="px-3 py-2 text-right">
                      <Input aria-label={`${M.label} contado`} inputMode="decimal" placeholder={r.method === 'cash' ? 'Contar' : undefined} autoFocus={r.method === 'cash'}
                        className="ml-auto h-9 w-28 text-right tabular-nums" value={counted[r.method] ?? ''} onChange={(e) => setCounted({ ...counted, [r.method]: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 text-right"><Diff cents={r.diff} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <span className="font-medium text-slate-700">Resultado del arqueo</span>
          {cash?.c === null ? <span className="text-slate-400">Falta contar el efectivo</span> : <Diff cents={total} big />}
        </div>
        <Field label={total !== 0 ? 'Observación (recomendado si no cuadra)' : 'Observación (opcional)'}>
          {(p) => <Input {...p} maxLength={500} placeholder={total < 0 ? 'Se dio vuelto de más a un cliente' : ''} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

/** "Cuadra" / "Faltan S/ 5.00" / "Sobran S/ 2.00", con icono además del color. */
export function Diff({ cents, big }: { cents: number | null; big?: boolean }) {
  if (cents === null) return <span className="text-slate-400">—</span>;
  const [Icon, label, cls] =
    cents === 0 ? [CircleCheck, 'Cuadra', 'text-emerald-700'] : cents < 0 ? [CircleMinus, `Faltan ${formatMoney(-cents)}`, 'text-red-700'] : [CirclePlus, `Sobran ${formatMoney(cents)}`, 'text-amber-700'];
  return (
    <span className={cn('inline-flex items-center gap-1 font-semibold tabular-nums', cls, big && 'text-base')}>
      <Icon className={big ? 'size-5' : 'size-4'} aria-hidden />{label}
    </span>
  );
}
