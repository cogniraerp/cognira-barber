import type { SaleDto } from '@/api/generated/model';
import { cn, formatMoney } from '@/lib/utils';
import { METHOD, type Method } from '../cash/methods';
import { useShop } from '../shop-context';

/**
 * Ticket de venta (nota de venta interna, no es comprobante SUNAT). Se ve en pantalla y, al
 * imprimir, es lo único que sale en papel de 80 mm (clase `print-ticket`, ver index.css).
 */
export function Ticket({ sale, changeCents, className }: { sale: SaleDto; changeCents?: number; className?: string }) {
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const when = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(sale.createdAt));
  const m = (c: number) => formatMoney(c, sale.currency);
  return (
    <div className={cn('print-ticket mx-auto w-full max-w-[19rem] rounded-xl border border-dashed border-slate-300 bg-white p-4 font-mono text-[12px] leading-snug text-slate-900', className)}>
      <p className="text-center text-sm font-bold">{shop.barbershop.name}</p>
      <p className="text-center">Nota de venta {sale.code}</p>
      <p className="text-center text-slate-500">{when}</p>
      {sale.status === 'voided' && <p className="mt-1 text-center font-bold">*** ANULADA ***</p>}
      <hr className="my-2 border-dashed border-slate-300" />
      {sale.customer && <p>Cliente: {sale.customer.fullName}</p>}
      {sale.createdBy && <p>Atendió: {sale.createdBy}</p>}
      <hr className="my-2 border-dashed border-slate-300" />
      {sale.items.map((it) => (
        <div key={it.id} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="min-w-0">{it.quantity > 1 ? `${it.quantity} × ` : ''}{it.name}</span>
            <span className="shrink-0 tabular-nums">{m(it.unitPriceCents * it.quantity)}</span>
          </div>
          {it.staff && <p className="text-slate-500">  {it.staff.displayName}</p>}
          {it.discountCents > 0 && <div className="flex justify-between text-slate-500"><span>  Descuento</span><span>−{m(it.discountCents)}</span></div>}
        </div>
      ))}
      <hr className="my-2 border-dashed border-slate-300" />
      <Row label="Subtotal" value={m(sale.subtotalCents)} />
      {sale.discountCents > 0 && <Row label="Descuento" value={`−${m(sale.discountCents)}`} />}
      {sale.tipCents > 0 && <Row label={`Propina${sale.tipStaff ? ` (${sale.tipStaff.displayName})` : ''}`} value={m(sale.tipCents)} />}
      <Row label="TOTAL" value={m(sale.totalCents)} bold />
      <hr className="my-2 border-dashed border-slate-300" />
      {sale.payments.map((p, i) => <Row key={i} label={`${METHOD[p.method as Method].label}${p.reference ? ` · ${p.reference}` : ''}`} value={m(p.amountCents)} />)}
      {changeCents ? <Row label="Vuelto" value={m(changeCents)} /> : null}
      <hr className="my-2 border-dashed border-slate-300" />
      <p className="text-center">¡Gracias por tu visita!</p>
      <p className="text-center text-[10px] text-slate-400">No es comprobante de pago electrónico</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', bold && 'text-sm font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

