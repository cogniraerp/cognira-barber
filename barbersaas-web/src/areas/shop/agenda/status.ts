import { Ban, CheckCheck, CircleCheck, Clock, Hourglass, Scissors, UserX, type LucideIcon } from 'lucide-react';
import type { AppointmentDto } from '@/api/generated/model';

export type Status = AppointmentDto['status'];

/**
 * Cada estado tiene color, icono y etiqueta: el color nunca va solo (daltonismo, impresión).
 * Fondo claro + borde del color del estado; el texto es casi negro (contraste AA en todos).
 */
export type Tone = { bg: string; line: string; fg: string };
export const STATUS: Record<Status, { label: string; icon: LucideIcon; tone: Tone; dot: string }> = {
  // Reserva online apartada mientras el cliente paga el adelanto (vence sola si no paga).
  awaiting_payment: {
    label: 'Esperando adelanto',
    icon: Hourglass,
    tone: { bg: '#fff7ed', line: '#ea580c', fg: '#431407' },
    dot: 'bg-orange-500',
  },
  pending: {
    label: 'Por confirmar',
    icon: Clock,
    tone: { bg: '#fffbeb', line: '#d97706', fg: '#451a03' },
    dot: 'bg-amber-500',
  },
  confirmed: {
    label: 'Confirmada',
    icon: CircleCheck,
    tone: { bg: '#f0f9ff', line: '#0284c7', fg: '#082f49' },
    dot: 'bg-sky-600',
  },
  in_progress: {
    label: 'En atención',
    icon: Scissors,
    tone: { bg: '#f5f3ff', line: '#7c3aed', fg: '#2e1065' },
    dot: 'bg-violet-600',
  },
  completed: {
    label: 'Completada',
    icon: CheckCheck,
    tone: { bg: '#ecfdf5', line: '#059669', fg: '#022c22' },
    dot: 'bg-emerald-600',
  },
  no_show: {
    label: 'No asistió',
    icon: UserX,
    tone: { bg: '#fef2f2', line: '#dc2626', fg: '#450a0a' },
    dot: 'bg-red-600',
  },
  canceled: {
    label: 'Cancelada',
    icon: Ban,
    tone: { bg: 'var(--muted)', line: '#a1a1aa', fg: 'var(--muted-foreground)' },
    dot: 'bg-muted-foreground/50',
  },
};

/** Transiciones permitidas (espejo de la API). */
export const NEXT: Record<Status, Array<Exclude<Status, 'pending' | 'awaiting_payment'>>> = {
  // Se confirma sola al pagarse; la barbería solo puede cancelarla (libera el horario).
  awaiting_payment: ['canceled'],
  pending: ['confirmed', 'canceled'],
  confirmed: ['in_progress', 'completed', 'no_show', 'canceled'],
  in_progress: ['completed', 'canceled'],
  completed: [],
  no_show: [],
  canceled: [],
};

export const ACTION_LABEL: Record<Exclude<Status, 'pending' | 'awaiting_payment'>, string> = {
  confirmed: 'Confirmar',
  in_progress: 'Empezar',
  completed: 'Completar',
  no_show: 'No asistió',
  canceled: 'Cancelar cita',
};

export const SOURCE_LABEL: Record<AppointmentDto['source'], string> = {
  online: 'Reserva online',
  walk_in: 'Walk-in',
  staff: 'Panel',
  phone: 'Teléfono',
};

export const TIME_OFF_LABEL = { block: 'Bloqueo', absence: 'Ausencia', vacation: 'Vacaciones' } as const;

export const toneStyle = (t: Tone) => ({ backgroundColor: t.bg, borderColor: t.line, color: t.fg });

/** Estado del adelanto, como se muestra en la cita (texto con el monto; nunca solo color). */
export const DEPOSIT_LABEL: Partial<Record<string, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }>> = {
  pending: { label: 'Adelanto pendiente', tone: 'warning' },
  paid: { label: 'Adelanto pagado', tone: 'success' },
  applied: { label: 'Adelanto aplicado', tone: 'info' },
  refund_pending: { label: 'Adelanto por devolver', tone: 'warning' },
  refunded: { label: 'Adelanto devuelto', tone: 'neutral' },
  retained: { label: 'Adelanto retenido', tone: 'neutral' },
};
