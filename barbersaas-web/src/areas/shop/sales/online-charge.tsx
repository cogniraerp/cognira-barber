import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Copy, ExternalLink, Hourglass, MessageCircle, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useChargesControllerCancel, useChargesControllerGet, useChargesControllerRefresh } from '@/api/generated/endpoints';
import type { ChargeDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { useShop } from '../shop-context';
import { saved } from '../settings/shared-utils';
import { CHARGE_STATUS } from './charge-status';

/**
 * Cobro por link/QR: el cliente escanea o abre el link y paga en la pasarela de la barbería.
 * Se consulta el estado cada 3 s (el webhook lo actualiza); "Verificar ahora" pregunta a la pasarela.
 */
export function OnlineChargeDialog({ initial, onPaid, onClose }: {
  initial: ChargeDto;
  onPaid: (charge: ChargeDto) => void;
  onClose: () => void;
}) {
  const shop = useShop();
  const q = useChargesControllerGet(initial.id, {
    query: { initialData: initial, refetchInterval: (s) => (s.state.data?.status === 'pending' ? 3000 : false) },
  });
  const refresh = useChargesControllerRefresh();
  const cancel = useChargesControllerCancel();
  const c = q.data ?? initial;
  const url = c.checkoutUrl ?? '';
  const qr = useQuery({
    queryKey: ['qr', url],
    queryFn: () => QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#060b1e' } }),
    enabled: !!url,
    staleTime: Infinity,
  });
  const S = CHARGE_STATUS[c.status];
  const tz = shop.barbershop.timezone;
  const until = new Intl.DateTimeFormat('es-PE', { timeStyle: 'short', timeZone: tz }).format(new Date(c.expiresAt));
  const text = `Hola, este es el link para pagar ${formatMoney(c.amountCents)} en ${shop.barbershop.name}: ${url}`;
  const err: unknown = refresh.error ?? cancel.error;

  return (
    <Dialog open onClose={onClose} title={`Cobro en línea · ${formatMoney(c.amountCents)}`} className="max-w-md"
      description={c.status === 'pending' ? `Que el cliente escanee el QR o envíale el link. Vence a las ${until}` : undefined}
      footer={
        c.status === 'paid' ? (
          <Button size="lg" onClick={() => onPaid(c)}><CircleCheck aria-hidden /> Usar este pago</Button>
        ) : c.status === 'pending' ? (
          <>
            <Button variant="ghost" className="mr-auto text-red-700" loading={cancel.isPending} onClick={() => cancel.mutate({ id: c.id }, { onSuccess: onClose })}>Cancelar cobro</Button>
            <Button variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate({ id: c.id }, { onSuccess: () => q.refetch() })}><RefreshCw aria-hidden /> Verificar ahora</Button>
          </>
        ) : (
          <Button onClick={onClose}>Cerrar</Button>
        )
      }>
      <div className="grid justify-items-center gap-4">
        {err ? <Alert title={errorMessage(err, i18n.t)} /> : null}
        <Badge tone={S.tone} className="text-sm"><S.icon className="mr-1 size-4" aria-hidden />{S.label}</Badge>
        {c.status === 'paid' ? (
          <div className="grid justify-items-center gap-2 py-6 text-center">
            <CircleCheck className="size-16 text-emerald-600" aria-hidden />
            <p className="text-lg font-semibold text-slate-900">Pago recibido</p>
            {c.providerPaymentId && <p className="font-mono text-sm text-slate-500">Operación {c.providerPaymentId}</p>}
          </div>
        ) : c.status === 'pending' ? (
          <>
            {qr.data ? (
              <img src={qr.data} alt={`Código QR para pagar ${formatMoney(c.amountCents)}`} className="size-60 rounded-xl border border-slate-200 bg-white p-2" />
            ) : (
              <div className="grid size-60 place-items-center rounded-xl border border-dashed border-slate-300"><Hourglass className="size-6 text-slate-400" aria-hidden /></div>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(url); saved('Link copiado'); }}><Copy aria-hidden /> Copiar link</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}><MessageCircle aria-hidden /> WhatsApp</a>
              <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><ExternalLink aria-hidden /> Abrir</a>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-slate-500" aria-live="polite"><RefreshCw className="size-3 animate-spin [animation-duration:3s]" aria-hidden />Esperando el pago…</p>
          </>
        ) : (
          <p className="py-6 text-center text-slate-600">Este cobro ya no se puede pagar. Genera uno nuevo si hace falta.</p>
        )}
      </div>
    </Dialog>
  );
}
