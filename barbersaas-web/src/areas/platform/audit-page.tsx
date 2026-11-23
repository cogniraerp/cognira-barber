import { keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuditLogsControllerList } from '@/api/generated/endpoints';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, PageHeader, Pagination, SearchField, Table, Td, Th } from '@/components/ui/table';
import { useListParams } from '@/lib/use-list-params';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/use-debounced';
import { fmtDateTime } from './components/format';

/** Quién hizo qué y cuándo. Filtro por prefijo de acción ("platform.", "shop.appointment"…). */
export function AuditPage() {
  const { t } = useTranslation();
  const L = useListParams(20);
  const debounced = useDebounced(L.get('action'), 300);
  const list = useAuditLogsControllerList(
    { page: L.page, pageSize: L.pageSize, action: debounced || undefined, barbershopId: L.get('barbershopId') || undefined },
    { query: { placeholderData: keepPreviousData } },
  );
  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title={t('nav.audit')} subtitle="Quién hizo qué y cuándo, con el detalle de cada cambio." />
      <FilterBar>
        <SearchField value={L.get('action')} onChange={(e) => L.set({ action: e.target.value })} placeholder="Acción, p. ej. platform. o shop.appointment" label="Filtrar por acción" />
        {L.get('barbershopId') && <Badge tone="info" className="h-11 gap-2 rounded-lg px-3">Filtrado por barbería <button type="button" className="underline" onClick={() => L.set({ barbershopId: null })}>quitar</button></Badge>}
      </FilterBar>
      {list.error ? <Alert title={errorMessage(list.error, t)} /> : !list.data ? <Skeleton className="h-64" /> : list.data.items.length === 0 ? <EmptyState title="Sin registros" /> : (
        <>
          <Table>
            <thead><tr><Th>Fecha</Th><Th>Acción</Th><Th>Entidad</Th><Th>Origen</Th><Th>Detalle</Th></tr></thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</Td>
                  <Td><code className="text-xs">{a.action}</code>{a.impersonatorUserId && <div><Badge tone="warning">impersonación</Badge></div>}</Td>
                  <Td className="text-xs text-muted-foreground">{a.entity ?? '—'}</Td>
                  <Td className="text-xs text-muted-foreground">{a.ip ?? '—'}</Td>
                  <Td className="max-w-md">
                    {a.diff ? <details><summary className="cursor-pointer text-xs text-muted-foreground">ver cambios</summary><pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(a.diff, null, 2)}</pre></details> : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}
    </div>
  );
}
