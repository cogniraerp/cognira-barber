import { CircleCheck, Globe, Hourglass } from 'lucide-react';

/** Estado del dominio propio (siempre icono + texto). */
export const DOMAIN_STATUS = {
  none: { label: 'Sin dominio propio', icon: Globe, tone: 'neutral' },
  pending: { label: 'Pendiente de verificar', icon: Hourglass, tone: 'warning' },
  verified: { label: 'Verificado', icon: CircleCheck, tone: 'success' },
} as const;
