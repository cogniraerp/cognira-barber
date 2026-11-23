import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { platformComplaintsControllerRespond, usePlatformComplaintsControllerList } from '@/api/generated/endpoints';
import type { ComplaintFilter } from '@/components/complaints/complaint-status';
import { ComplaintsInbox } from '@/components/complaints/complaints-inbox';
import { PageHeader } from '@/components/ui/table';
import { useAuth } from '@/stores/auth';

/** Libro de Reclamaciones de Cognira (reclamos de las barberías que contratan el servicio). */
export function ComplaintsPage() {
  const qc = useQueryClient();
  const isSuper = useAuth((s) => s.user?.platformRole === 'superadmin');
  const [filter, setFilter] = useState<ComplaintFilter>('pending');
  const [page, setPage] = useState(1);
  const q = usePlatformComplaintsControllerList({ page, pageSize: 10, ...(filter === 'all' ? {} : { status: filter }) });
  return (
    <div className="grid gap-6 p-4 sm:p-6">
      <PageHeader title="Libro de Reclamaciones" subtitle="Hojas registradas en /libro-reclamaciones. Plazo de respuesta: 15 días hábiles." />
      <ComplaintsInbox
        data={q.data}
        error={q.error}
        filter={filter}
        onFilter={(f) => { setFilter(f); setPage(1); }}
        page={page}
        onPage={setPage}
        canRespond={isSuper}
        respond={async (id, response) => {
          await platformComplaintsControllerRespond(id, { response });
          await qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/v1/platform/complaints') });
        }}
      />
    </div>
  );
}
