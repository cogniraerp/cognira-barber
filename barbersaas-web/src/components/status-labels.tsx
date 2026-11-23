import { AlertTriangle, Ban, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/misc';

/** Estados con icono + texto (nunca solo color). */
const SHOP: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  onboarding: { label: 'Configurando', tone: 'info' },
  active: { label: 'Activa', tone: 'success' },
  suspended: { label: 'Suspendida', tone: 'danger' },
  deleted: { label: 'Eliminada', tone: 'neutral' },
};
const SUB: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  trialing: { label: 'En prueba', tone: 'info' },
  active: { label: 'Activa', tone: 'success' },
  past_due: { label: 'Morosa', tone: 'warning' },
  suspended: { label: 'Suspendida', tone: 'danger' },
  canceled: { label: 'Cancelada', tone: 'neutral' },
};
const INV: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  open: { label: 'Pendiente', tone: 'warning' },
  paid: { label: 'Pagada', tone: 'success' },
  void: { label: 'Anulada', tone: 'neutral' },
  failed: { label: 'Fallida', tone: 'danger' },
};
const ICON = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, neutral: Ban, info: Clock } as const;

function StatusBadge({ map, value }: { map: typeof SHOP; value: string }) {
  const s = map[value] ?? { label: value, tone: 'neutral' as const };
  const Icon = ICON[s.tone];
  return (
    <Badge tone={s.tone} className="gap-1">
      <Icon className="size-3" aria-hidden /> {s.label}
    </Badge>
  );
}

export const ShopStatus = ({ value }: { value: string }) => <StatusBadge map={SHOP} value={value} />;
export const SubStatus = ({ value }: { value: string }) => <StatusBadge map={SUB} value={value} />;
export const InvoiceStatus = ({ value }: { value: string }) => <StatusBadge map={INV} value={value} />;

