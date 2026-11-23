import { CirclePause, CreditCard, MessageCircle } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button-variants';

/**
 * Barbería suspendida: el panel queda bloqueado salvo Suscripción. Si fue por falta de pago,
 * el dueño paga y se reactiva al instante; si fue manual, debe escribir a soporte.
 */
export function SuspendedScreen({ reason, canPay, slug }: { reason: 'manual' | 'billing' | null; canPay: boolean; slug: string }) {
  const billing = reason === 'billing';
  return (
    <div className="mx-auto grid max-w-lg justify-items-center gap-4 px-6 py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-red-50"><CirclePause className="size-8 text-red-700" aria-hidden /></span>
      <h1 className="text-2xl font-semibold text-slate-900">Tu barbería está pausada</h1>
      <p className="text-slate-600">
        {billing
          ? 'Tienes una factura de tu suscripción sin pagar. Mientras tanto el panel está bloqueado y tu página no recibe reservas. Tus datos están a salvo.'
          : 'El equipo de Cognira Barber pausó el acceso a esta barbería. Tus datos están a salvo.'}
      </p>
      {billing ? (
        canPay ? (
          <Link to={`/s/${slug}/configuracion/suscripcion`} className={buttonVariants({ size: 'lg' })}><CreditCard aria-hidden /> Pagar y reactivar</Link>
        ) : (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">Pídele al dueño de la barbería que pague la factura: se reactiva al instante.</p>
        )
      ) : (
        <a href="mailto:soporte@cognira.pe" className={buttonVariants({ variant: 'outline' })}><MessageCircle aria-hidden /> Escribir a soporte</a>
      )}
      {billing && <p className="text-xs text-slate-500">Al confirmarse el pago, todo vuelve a funcionar en segundos.</p>}
    </div>
  );
}
