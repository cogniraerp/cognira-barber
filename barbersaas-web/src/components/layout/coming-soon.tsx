import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/ui/misc';

export function ComingSoon() {
  return (
    <div className="p-6">
      <EmptyState
        title="Sección en construcción"
        description="Este módulo llega en los próximos pasos del frontend."
        action={<Construction className="text-muted-foreground size-6" aria-hidden />}
      />
    </div>
  );
}
