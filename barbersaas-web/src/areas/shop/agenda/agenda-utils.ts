import { useQueryClient } from '@tanstack/react-query';
import type { AppointmentListDtoItem, StaffDtoOutput } from '@/api/generated/model';
import { useCan, useShop } from '../shop-context';

export type Appt = AppointmentListDtoItem;

/** Refresca la agenda (citas y bloqueos) y lo que depende de ella (inicio del panel). */
export function useAgendaRefresh() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({
      predicate: (q) => ['/v1/shop/appointments', '/v1/shop/time-off'].includes(String(q.queryKey[0])),
    });
}

/**
 * Qué puede hacer el usuario en la agenda:
 *  - manage_all: todo, sobre cualquier barbero (dueño, admin, recepción).
 *  - manage_own: solo sus citas y sus bloqueos (barbero).
 */
export function useAgendaAccess() {
  const shop = useShop();
  const can = useCan();
  const all = can('appointments.manage_all');
  const own = can('appointments.manage_own') && !!shop.staffId;
  return {
    viewAll: can('appointments.view_all'),
    canCreate: all || own,
    canManage: (staffId: string | null | undefined) => all || (own && staffId === shop.staffId),
    canBlock: (staffId: string) => all || can('staff.manage') || (own && staffId === shop.staffId),
    canRemoveTimeOff: (staffId: string, kind: string) =>
      can('staff.manage') || (kind === 'block' && (all || (own && staffId === shop.staffId))),
    /** Barberos sobre los que puede crear/mover. */
    manageable: (staff: StaffDtoOutput[]) => staff.filter((s) => all || (own && s.id === shop.staffId)),
    ownStaffId: shop.staffId,
  };
}

/** wa.me solo si el teléfono no está enmascarado (rol sin permiso para ver contactos). */
export function whatsappLink(phone: string | null | undefined): string | null {
  if (!phone || phone.includes('•')) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
