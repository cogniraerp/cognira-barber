import type { SaleDto } from '@/api/generated/model';
import { formatMoney } from '@/lib/utils';
import { METHOD, type Method } from '../cash/methods';

/** Texto del ticket para WhatsApp. */
export function ticketText(sale: SaleDto, shopName: string): string {
  const m = (c: number) => formatMoney(c, sale.currency);
  const lines = [
    `*${shopName}* · Nota de venta ${sale.code}`,
    ...sale.items.map((it) => `• ${it.quantity > 1 ? `${it.quantity} × ` : ''}${it.name}: ${m(it.unitPriceCents * it.quantity - it.discountCents)}`),
    ...(sale.discountCents ? [`Descuento: −${m(sale.discountCents)}`] : []),
    ...(sale.tipCents ? [`Propina: ${m(sale.tipCents)}`] : []),
    `*Total: ${m(sale.totalCents)}*`,
    `Pago: ${sale.payments.map((p) => METHOD[p.method as Method].label).join(' + ')}`,
    '¡Gracias por tu visita!',
  ];
  return lines.join('\n');
}

/** wa.me con el ticket; al cliente si tiene teléfono visible, si no se elige el contacto. */
export function whatsappTicketUrl(sale: SaleDto, shopName: string): string {
  const phone = sale.customer?.phone && !sale.customer.phone.includes('•') ? sale.customer.phone.replace(/\D/g, '') : '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(ticketText(sale, shopName))}`;
}

