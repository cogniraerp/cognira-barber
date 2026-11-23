import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { shopComplaintsControllerRespond, useShopComplaintsControllerList } from '@/api/generated/endpoints';
import type { ComplaintFilter } from '@/components/complaints/complaint-status';
import { ComplaintsInbox } from '@/components/complaints/complaints-inbox';
import { useShop } from '../shop-context';
import { Section } from './shared';

/** Libro de Reclamaciones de la barbería: las hojas de sus clientes y su respuesta (15 días hábiles). */
export function ComplaintsSettings() {
  const qc = useQueryClient();
  const { barbershop } = useShop();
  const [filter, setFilter] = useState<ComplaintFilter>('pending');
  const [page, setPage] = useState(1);
  const q = useShopComplaintsControllerList({ page, pageSize: 10, ...(filter === 'all' ? {} : { status: filter }) });
  return (
    <Section
      title="Hojas recibidas"
      description="Tu libro virtual, como exige INDECOPI. Está enlazado en el pie de tu página de reservas; te avisamos por correo cuando llega una hoja."
      actions={
        <a href={`/b/${barbershop.slug}/libro-reclamaciones`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-marca-700 hover:underline">
          Ver el formulario <ExternalLink className="size-3.5" aria-hidden />
        </a>
      }
    >
      <ComplaintsInbox
        data={q.data}
        error={q.error}
        filter={filter}
        onFilter={(f) => { setFilter(f); setPage(1); }}
        page={page}
        onPage={setPage}
        respond={async (id, response) => {
          await shopComplaintsControllerRespond(id, { response });
          await qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/v1/shop/complaints') });
        }}
      />
    </Section>
  );
}
