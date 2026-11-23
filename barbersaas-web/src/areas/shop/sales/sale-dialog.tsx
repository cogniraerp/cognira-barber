import { Ban, MessageCircle, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSalesControllerGet, useSalesControllerVoid } from '@/api/generated/endpoints';
import type { SaleDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/utils';
import { useCan, useShop } from '../shop-context';
import { saved, useRefreshShop } from '../settings/shared-utils';
import { Ticket } from './ticket';
import { whatsappTicketUrl } from './ticket-utils';

/** Detalle de una venta: ticket, reimprimir, enviar por WhatsApp y anular (con motivo). */
export function SaleDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useSalesControllerGet(id);
  return (
    <Dialog open onClose={onClose} title={q.data ? `Venta ${q.data.code}` : 'Venta'} className="max-w-md">
      {!q.data ? <Skeleton className="h-96" /> : <SaleBody sale={q.data} />}
    </Dialog>
  );
}

function SaleBody({ sale }: { sale: SaleDto }) {
  const { t } = useTranslation();
  const can = useCan();
  const shop = useShop();
  const refresh = useRefreshShop();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const voidSale = useSalesControllerVoid({ mutation: { onSuccess: async () => { await refresh(); saved('Venta anulada: se devolvió el stock y se registró la devolución en caja'); setVoiding(false); } } });
  return (
    <div className="grid gap-4">
      {sale.status === 'voided' && (
        <Alert title={`Anulada${sale.voidedBy ? ` por ${sale.voidedBy}` : ''}`}>Motivo: {sale.voidReason}</Alert>
      )}
      <Ticket sale={sale} />
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => window.print()}><Printer aria-hidden /> Imprimir</Button>
        <a href={whatsappTicketUrl(sale, shop.barbershop.name)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}><MessageCircle aria-hidden /> WhatsApp</a>
        {sale.status === 'completed' && can('sales.void') && !voiding && (
          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setVoiding(true)}><Ban aria-hidden /> Anular</Button>
        )}
      </div>
      {voiding && (
        <form className="grid gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4" onSubmit={(e) => { e.preventDefault(); voidSale.mutate({ id: sale.id, data: { reason: reason.trim() } }); }}>
          <p className="text-sm text-slate-700">Se devuelve el stock de los productos y se registra la devolución de {formatMoney(sale.totalCents, sale.currency)} en la caja abierta.</p>
          {voidSale.error ? <Alert title={errorMessage(voidSale.error, t)} /> : null}
          <Field label="Motivo de la anulación">{(p) => <Input {...p} autoFocus required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Se cobró de más" />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setVoiding(false)}>Volver</Button>
            <Button type="submit" variant="destructive" loading={voidSale.isPending} disabled={reason.trim().length < 3}>Anular venta</Button>
          </div>
        </form>
      )}
    </div>
  );
}
