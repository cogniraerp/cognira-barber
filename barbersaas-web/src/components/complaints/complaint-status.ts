import { AlarmClock, CircleCheck, Hourglass } from 'lucide-react';

/** Estado de una hoja del Libro de Reclamaciones (siempre icono + texto). */
export const COMPLAINT_STATUS = {
  pending: { label: 'Por responder', icon: Hourglass, tone: 'warning' },
  overdue: { label: 'Vencida', icon: AlarmClock, tone: 'danger' },
  answered: { label: 'Respondida', icon: CircleCheck, tone: 'success' },
} as const;

export type ComplaintFilter = 'pending' | 'answered' | 'all';
