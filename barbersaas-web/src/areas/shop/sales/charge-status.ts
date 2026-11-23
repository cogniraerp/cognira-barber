import { Ban, CircleCheck, CircleX, Clock, Hourglass, type LucideIcon } from 'lucide-react';

export type ChargeStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'canceled';
/** Estado de un cobro en línea: icono + texto (nunca solo color). */
export const CHARGE_STATUS: Record<ChargeStatus, { label: string; icon: LucideIcon; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  pending: { label: 'Esperando pago', icon: Hourglass, tone: 'warning' },
  paid: { label: 'Pagado', icon: CircleCheck, tone: 'success' },
  failed: { label: 'Falló', icon: CircleX, tone: 'danger' },
  expired: { label: 'Vencido', icon: Clock, tone: 'neutral' },
  canceled: { label: 'Cancelado', icon: Ban, tone: 'neutral' },
};
