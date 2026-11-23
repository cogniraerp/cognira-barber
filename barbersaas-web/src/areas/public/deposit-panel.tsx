import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CreditCard, ExternalLink, Hourglass, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import {
  getPublicBookingControllerViewQueryKey,
  usePublicBookingControllerCancel,
  usePublicBookingControllerCheckDeposit,
} from '@/api/generated/endpoints';
import type { PublicAppointmentDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Alert } from '@/components/ui/misc';
import { formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useNow } from '@/lib/use-now';
import { formatMoney } from '@/lib/utils';
import { forgetBooking, remaining } from './public-utils';

/**
 * Pago del adelanto en la página de la cita: botón a la pasarela (otra pestaña), contador del
 * horario apartado, "Ya pagué" y "Ya no quiero reservar". La página se actualiza sola al pagarse.
 */
export function DepositPanel({ a, token, homeHref }: { a: PublicAppointmentDto; token: string; homeHref: string }) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const d = a.deposit!;
  const put = (r: PublicAppointmentDto) => qc.setQueryData(getPublicBookingControllerViewQueryKey(token), r);
  const check = usePublicBookingControllerCheckDeposit({ mutation: { onSuccess: put } });
  const cancel = usePublicBookingControllerCancel({ mutation: { onSuccess: (r) => { forgetBooking(a.shop.slug, token); put(r); } } });
  const left = remaining(d.holdExpiresAt, now);
  const err: unknown = check.error ?? cancel.error;

  if (a.status === 'canceled' && d.status === 'expired')
    return (
      <Alert tone="info" title="Se venció el tiempo para pagar el adelanto">
        Tu horario se liberó y no se hizo ningún cobro. <Link to={homeHref} className="font-medium underline">Reservar de nuevo</Link>
      </Alert>
    );
  if (d.status === 'refunded')
    return (
      <Alert tone="info" title={`Te devolvimos ${formatMoney(d.amountCents, a.currency)}`}>
        La devolución se hizo a tu medio de pago. Puede tardar unos días en verse en tu cuenta, según tu banco.
      </Alert>
    );
  if (d.status === 'refund_pending')
    return (
      <Alert tone="info" title={a.status === 'canceled' ? 'Tu adelanto se está devolviendo' : 'Recibimos tu pago después de vencer el tiempo'}>
        Te devolveremos {formatMoney(d.amountCents, a.currency)} a tu medio de pago en unos minutos.
      </Alert>
    );
  if (a.status !== 'awaiting_payment' || d.status !== 'pending') return null;

  return (
    <section className="grid gap-4 rounded-2xl border-2 border-orange-300 bg-orange-50/60 p-5" aria-labelledby="deposit-title">
      {err ? <Alert title={errorMessage(err, i18n.t)} /> : null}
      <div className="grid gap-1">
        <h2 id="deposit-title" className="text-lg font-semibold">Paga {formatMoney(d.amountCents, a.currency)} para confirmar tu cita</h2>
        <p className="text-sm text-muted-foreground">
          Es un adelanto: se descuenta del total ({formatMoney(a.totalCents, a.currency)}) y el resto lo pagas en el local.
        </p>
      </div>
      <p className="flex items-start gap-2 text-sm font-medium" aria-live="polite">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-orange-700" aria-hidden />
        <span>
          {left.ms > 0
            ? <>Te guardamos el horario <span className="tabular-nums">{left.label}</span> min más (hasta las {formatTime(d.holdExpiresAt, a.timezone)}).</>
            : 'El tiempo terminó: estamos verificando tu pago…'}
        </span>
      </p>
      {d.payUrl && left.ms > 0 && (
        <a href={d.payUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'brand', size: 'lg' })}>
          <CreditCard aria-hidden /> Pagar adelanto {formatMoney(d.amountCents, a.currency)} <ExternalLink className="size-4 opacity-70" aria-hidden />
        </a>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" loading={check.isPending} onClick={() => check.mutate({ token })}><RefreshCw aria-hidden /> Ya pagué</Button>
        <Button variant="ghost" className="text-destructive" loading={cancel.isPending} onClick={() => cancel.mutate({ token, data: { reason: 'El cliente desistió antes de pagar' } })}>
          Ya no quiero reservar
        </Button>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        El pago se hace en la página segura de la pasarela de {a.shop.name}. Esta página se actualiza sola cuando se confirma.
      </p>
    </section>
  );
}
