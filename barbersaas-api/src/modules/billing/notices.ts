import type { BillingNoticeKind } from '../../generated/prisma/enums';

export interface NoticeContext {
  barbershop: string;
  ownerName: string | null;
  invoiceNumber: string;
  amount: string;
  period: string;
  dueAt: string;
  suspendsAt: string;
  payUrl: string;
}

/** Correos de cobranza (texto plano, en español, con el link para pagar). */
export function noticeEmail(
  kind: BillingNoticeKind,
  c: NoticeContext,
): { subject: string; body: string } {
  const hi = `Hola${c.ownerName ? ` ${c.ownerName.split(' ')[0]}` : ''},`;
  const pay = `Págala en línea o mira tus facturas aquí:\n${c.payUrl}`;
  const sign = '\n\n— Equipo Cognira Barber';
  switch (kind) {
    case 'invoice_issued':
      return {
        subject: `Tu factura de Cognira Barber (${c.amount})`,
        body: `${hi}\n\nEmitimos la factura ${c.invoiceNumber} de ${c.barbershop} por ${c.amount}, del periodo ${c.period}. Vence el ${c.dueAt}.\n\n${pay}${sign}`,
      };
    case 'due_soon':
      return {
        subject: `Tu factura vence el ${c.dueAt}`,
        body: `${hi}\n\nTe recordamos que la factura ${c.invoiceNumber} por ${c.amount} vence el ${c.dueAt}.\n\n${pay}${sign}`,
      };
    case 'overdue':
      return {
        subject: 'Tu factura de Cognira Barber está vencida',
        body: `${hi}\n\nLa factura ${c.invoiceNumber} por ${c.amount} venció el ${c.dueAt}. Tu barbería sigue funcionando, pero si no se paga hasta el ${c.suspendsAt} pausaremos el panel y la página de reservas.\n\n${pay}${sign}`,
      };
    case 'final_warning':
      return {
        subject: `Último aviso: ${c.barbershop} se pausará el ${c.suspendsAt}`,
        body: `${hi}\n\nLa factura ${c.invoiceNumber} por ${c.amount} sigue pendiente. El ${c.suspendsAt} pausaremos el panel y tu página dejará de recibir reservas.\n\n${pay}${sign}`,
      };
    case 'suspended':
      return {
        subject: `Pausamos ${c.barbershop} por falta de pago`,
        body: `${hi}\n\nComo la factura ${c.invoiceNumber} por ${c.amount} no se pagó, pausamos el panel y tu página ya no recibe reservas. Tus datos están a salvo.\n\nPaga y se reactiva al instante:\n${c.payUrl}${sign}`,
      };
    case 'reactivated':
      return {
        subject: `¡Listo! ${c.barbershop} está activa de nuevo`,
        body: `${hi}\n\nRecibimos el pago de la factura ${c.invoiceNumber} (${c.amount}). Tu panel y tu página de reservas ya funcionan con normalidad.\n\nGracias por seguir con nosotros.${sign}`,
      };
  }
}

/**
 * WhatsApp (número de la plataforma). Fuera de la ventana de 24 h Meta exige una plantilla
 * aprobada: `billing_<tipo>` con los parámetros en orden; `body` es el mismo texto (consola y
 * proveedores sin plantillas).
 */
export function noticeWhatsApp(
  kind: BillingNoticeKind,
  c: NoticeContext,
): { body: string; template: { name: string; language: string; params: string[] } } {
  const texts: Record<BillingNoticeKind, [string, string[]]> = {
    invoice_issued: [
      `Cognira Barber: emitimos tu factura de ${c.amount} (${c.barbershop}). Vence el ${c.dueAt}. Págala aquí: ${c.payUrl}`,
      [c.amount, c.barbershop, c.dueAt, c.payUrl],
    ],
    due_soon: [
      `Cognira Barber: tu factura de ${c.amount} vence el ${c.dueAt}. Págala aquí: ${c.payUrl}`,
      [c.amount, c.dueAt, c.payUrl],
    ],
    overdue: [
      `Cognira Barber: tu factura de ${c.amount} venció el ${c.dueAt}. Si no se paga hasta el ${c.suspendsAt}, pausaremos ${c.barbershop}. Paga aquí: ${c.payUrl}`,
      [c.amount, c.dueAt, c.suspendsAt, c.barbershop, c.payUrl],
    ],
    final_warning: [
      `Cognira Barber · último aviso: el ${c.suspendsAt} pausaremos ${c.barbershop} y tu página dejará de recibir reservas. Paga ${c.amount} aquí: ${c.payUrl}`,
      [c.suspendsAt, c.barbershop, c.amount, c.payUrl],
    ],
    suspended: [
      `Cognira Barber: pausamos ${c.barbershop} por falta de pago (${c.amount}). Paga y se reactiva al instante: ${c.payUrl}`,
      [c.barbershop, c.amount, c.payUrl],
    ],
    reactivated: [
      `Cognira Barber: ¡listo! Recibimos tu pago y ${c.barbershop} ya está activa de nuevo.`,
      [c.barbershop],
    ],
  };
  const [body, params] = texts[kind];
  return { body, template: { name: `billing_${kind}`, language: 'es', params } };
}
