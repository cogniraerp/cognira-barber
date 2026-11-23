import type { Prisma } from '../../generated/prisma/client';

export const appointmentSelect = {
  id: true,
  status: true,
  source: true,
  startAt: true,
  endAt: true,
  locationId: true,
  totalCents: true,
  currency: true,
  customerNotes: true,
  internalNotes: true,
  customFields: true,
  cancelReason: true,
  createdAt: true,
  staff: { select: { id: true, displayName: true } },
  customer: {
    select: { id: true, fullName: true, phoneE164: true, email: true, noShowCount: true },
  },
  items: {
    select: { serviceId: true, nameSnapshot: true, priceCents: true, durationMin: true },
    orderBy: { sortOrder: 'asc' },
  },
  // Venta vigente (si ya se cobró en caja).
  sales: { where: { status: 'completed' }, select: { id: true }, take: 1 },
  // Adelanto de la reserva online (Fase 3).
  deposit: { select: { amountCents: true, status: true, chargeId: true } },
} as const satisfies Prisma.AppointmentSelect;
export type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

/** "+51987654321" → "+51 ••• ••• 321" (solo los 3 últimos dígitos, para reconocer al cliente). */
export function maskPhone(p: string): string {
  return p.length <= 7 ? '•••' : `${p.slice(0, 3)} ••• ••• ${p.slice(-3)}`;
}
export function maskEmail(e: string): string {
  const [u = '', d = ''] = e.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}

export function toAppointmentDto(a: AppointmentRow, opts: { showContact: boolean }) {
  const c = a.customer;
  const { sales, ...rest } = a;
  return {
    ...rest,
    saleId: sales[0]?.id ?? null,
    customFields: (a.customFields && typeof a.customFields === 'object'
      ? a.customFields
      : {}) as Record<string, unknown>,
    items: a.items.map((i) => ({
      serviceId: i.serviceId,
      name: i.nameSnapshot,
      priceCents: i.priceCents,
      durationMin: i.durationMin,
    })),
    customer: c
      ? {
          id: c.id,
          fullName: c.fullName,
          noShowCount: c.noShowCount,
          phone: c.phoneE164 ? (opts.showContact ? c.phoneE164 : maskPhone(c.phoneE164)) : null,
          email: c.email ? (opts.showContact ? c.email : maskEmail(c.email)) : null,
        }
      : null,
  };
}
