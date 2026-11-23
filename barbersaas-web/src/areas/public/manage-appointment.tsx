import { CalendarPlus, CalendarX2, Clock, MapPin, MessageCircle, Repeat } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { isApiError } from '@/api/errors';
import {
  getPublicBookingControllerViewQueryKey,
  usePublicBookingControllerCancel,
  usePublicBookingControllerReschedule,
  usePublicBookingControllerView,
} from '@/api/generated/endpoints';
import type { PublicAppointmentDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Field, Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { formatDateLong, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
import { STATUS, toneStyle } from '../shop/agenda/status';
import { DepositPanel } from './deposit-panel';
import { forgetBooking, rememberBooking } from './public-utils';
import { SlotPicker, type Slot } from './slot-picker';

/** Gestión por enlace (sin cuenta): ver, agregar al calendario, reprogramar o cancelar. */
export function ManageAppointment({ token, homeHref }: { token: string; homeHref: string }) {
  // Mientras espera el adelanto, se consulta seguido (el webhook de la pasarela confirma la cita).
  const q = usePublicBookingControllerView(token, {
    query: { retry: false, refetchInterval: (x) => (x.state.data?.status === 'awaiting_payment' ? 4000 : false) },
  });
  if (q.isPending) return <div className="mx-auto grid max-w-md gap-4 p-6"><Skeleton className="h-48" /><Skeleton className="h-24" /></div>;
  if (q.error || !q.data) {
    return (
      <div className="mx-auto grid max-w-md gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">No encontramos esta cita</h1>
        <p className="text-muted-foreground">El enlace puede estar incompleto. Revisa el mensaje de confirmación o comunícate con la barbería.</p>
        <Link to={homeHref} className={buttonVariants({ variant: 'outline' })}>Ir a la barbería</Link>
      </div>
    );
  }
  return <Manage a={q.data} token={token} homeHref={homeHref} />;
}

function Manage({ a, token, homeHref }: { a: PublicAppointmentDto; token: string; homeHref: string }) {
  const [mode, setMode] = useState<'view' | 'move' | 'cancel'>('view');
  const tz = a.timezone;
  const S = STATUS[a.status];
  const active = a.status === 'pending' || a.status === 'confirmed';
  const deadline = `${formatDateLong(new Date(a.changeDeadline), tz)} · ${formatTime(a.changeDeadline, tz)}`;
  const wa = a.shop.phone ? `https://wa.me/${a.shop.phone.replace(/\D/g, '')}` : null;
  const paidDeposit = a.deposit && (a.deposit.status === 'paid' || a.deposit.status === 'applied') ? a.deposit.amountCents : 0;
  const pendingDeposit = a.status === 'awaiting_payment' && a.deposit?.status === 'pending' ? a.deposit.amountCents : 0;

  return (
    <div className="mx-auto grid max-w-md gap-5 p-4 pb-10 sm:p-6">
      <Link to={homeHref} className="text-sm text-muted-foreground hover:text-foreground">← {a.shop.name}</Link>
      <header className="grid gap-2">
        <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full border border-l-4 px-2.5 py-0.5 text-sm font-medium" style={toneStyle(S.tone)}>
          <S.icon className="size-3.5" aria-hidden /> {a.status === 'pending' ? 'Esperando confirmación' : a.status === 'awaiting_payment' ? 'Falta pagar el adelanto' : S.label}
        </span>
        <h1 className={cn('text-2xl font-semibold first-letter:uppercase', a.status === 'canceled' && 'line-through opacity-60')}>
          {formatDateLong(new Date(a.startAt), tz)}
        </h1>
        <p className="flex items-center gap-1.5 text-lg"><Clock className="size-5" aria-hidden />{formatTime(a.startAt, tz)} – {formatTime(a.endAt, tz)}</p>
      </header>

      <div className="grid gap-3 rounded-xl border bg-card p-4 text-sm">
        <ul className="grid gap-1">
          {a.services.map((s) => (
            <li key={s.id} className="flex justify-between gap-3"><span>{s.name} <span className="text-muted-foreground">· {s.durationMin} min</span></span><span className="tabular-nums">{formatMoney(s.priceCents, a.currency)}</span></li>
          ))}
          {paidDeposit ? (
            <>
              <li className="flex justify-between gap-3 border-t pt-1"><span>Total</span><span className="tabular-nums">{formatMoney(a.totalCents, a.currency)}</span></li>
              <li className="flex justify-between gap-3 text-emerald-700"><span>Adelanto pagado</span><span className="tabular-nums">− {formatMoney(paidDeposit, a.currency)}</span></li>
              <li className="flex justify-between gap-3 font-semibold"><span>Pagas en el local</span><span className="tabular-nums">{formatMoney(a.totalCents - paidDeposit, a.currency)}</span></li>
            </>
          ) : pendingDeposit ? (
            <>
              <li className="flex justify-between gap-3 border-t pt-1"><span>Total</span><span className="tabular-nums">{formatMoney(a.totalCents, a.currency)}</span></li>
              <li className="flex justify-between gap-3 text-orange-800"><span>Adelanto al reservar</span><span className="tabular-nums">{formatMoney(pendingDeposit, a.currency)}</span></li>
              <li className="flex justify-between gap-3 font-semibold"><span>En el local</span><span className="tabular-nums">{formatMoney(a.totalCents - pendingDeposit, a.currency)}</span></li>
            </>
          ) : (
            <li className="flex justify-between gap-3 border-t pt-1 font-semibold"><span>Total (se paga en el local)</span><span className="tabular-nums">{formatMoney(a.totalCents, a.currency)}</span></li>
          )}
        </ul>
        <p>Con <strong>{a.staff.displayName}</strong></p>
        {a.shop.address && (
          <a className="flex items-start gap-1.5 underline-offset-2 hover:underline" target="_blank" rel="noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.shop.name}, ${a.shop.address}`)}`}>
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {a.shop.address}
          </a>
        )}
      </div>

      {a.deposit && <DepositPanel a={a} token={token} homeHref={homeHref} />}

      {mode === 'view' && (
        <div className="grid gap-2">
          {active && <a href={a.icsUrl} className={buttonVariants({ variant: 'outline', size: 'lg' })}><CalendarPlus aria-hidden /> Agregar a mi calendario</a>}
          {a.canReschedule && <Button size="lg" variant="brand" onClick={() => setMode('move')}><Repeat aria-hidden /> Cambiar día u hora</Button>}
          {a.canCancel && <Button size="lg" variant="ghost" className="text-destructive" onClick={() => setMode('cancel')}><CalendarX2 aria-hidden /> Cancelar cita</Button>}
          {active && !a.canCancel && (
            <Alert tone="info" title="Ya no se puede cambiar por aquí">
              El plazo para cambiar o cancelar online venció ({deadline}). Escríbele a la barbería.
            </Alert>
          )}
          {active && a.canCancel && <p className="text-center text-xs text-muted-foreground">Puedes cambiarla o cancelarla hasta el {deadline}.</p>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'link' })}><MessageCircle aria-hidden /> Escribir a la barbería</a>}
        </div>
      )}
      {mode === 'cancel' && <Cancel token={token} slug={a.shop.slug} onBack={() => setMode('view')} />}
      {mode === 'move' && <Move a={a} token={token} onBack={() => setMode('view')} />}
    </div>
  );
}

function Cancel({ token, slug, onBack }: { token: string; slug: string; onBack: () => void }) {
  const [reason, setReason] = useState('');
  const done = useDone(token);
  const cancel = usePublicBookingControllerCancel({ mutation: { onSuccess: (r) => { forgetBooking(slug, token); done(r); onBack(); } } });
  return (
    <form className="grid gap-3 rounded-xl border p-4" onSubmit={(e) => { e.preventDefault(); cancel.mutate({ token, data: reason.trim() ? { reason: reason.trim() } : {} }); }}>
      <h2 className="font-semibold">¿Cancelar la cita?</h2>
      {cancel.error ? <Alert title={errorMessage(cancel.error, i18n.t)} /> : null}
      <Field label="Motivo (opcional)">{(p) => <Input {...p} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Me surgió un imprevisto" />}</Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>No, mantenerla</Button>
        <Button type="submit" variant="destructive" loading={cancel.isPending}>Sí, cancelar</Button>
      </div>
    </form>
  );
}

function Move({ a, token, onBack }: { a: PublicAppointmentDto; token: string; onBack: () => void }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const done = useDone(token);
  const move = usePublicBookingControllerReschedule({
    mutation: { onSuccess: (r) => { rememberBooking(a.shop.slug, { token, startAt: r.startAt }); done(r); onBack(); } },
  });
  // Mismo barbero (es con quien reservó). El tope real de anticipación lo aplica la API.
  const maxDays = 60;
  return (
    <div className="grid gap-4 rounded-xl border p-4">
      <h2 className="font-semibold">Nuevo día y hora con {a.staff.displayName}</h2>
      {move.error ? <Alert title={isApiError(move.error as unknown, 'SLOT_TAKEN') ? 'Ese horario se acaba de ocupar. Elige otro.' : errorMessage(move.error, i18n.t)} /> : null}
      <SlotPicker slug={a.shop.slug} serviceIds={a.services.map((s) => s.id)} staffId={a.staff.id} tz={a.timezone} maxAdvanceDays={maxDays} value={slot} onChange={(s) => setSlot(s)} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>Volver</Button>
        <Button variant="brand" disabled={!slot} loading={move.isPending} onClick={() => slot && move.mutate({ token, data: { startAt: slot.start } })}>
          {slot ? `Cambiar a las ${formatTime(slot.start, a.timezone)}` : 'Elige un horario'}
        </Button>
      </div>
    </div>
  );
}

/** La API devuelve la cita actualizada: se pone en caché y se avisa. */
function useDone(token: string) {
  const qc = useQueryClient();
  return (r: PublicAppointmentDto) => {
    qc.setQueryData(getPublicBookingControllerViewQueryKey(token), r);
    toast.success(r.status === 'canceled' ? 'Cita cancelada' : 'Cita cambiada; te enviamos la confirmación');
  };
}
