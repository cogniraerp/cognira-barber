import { keepPreviousData } from '@tanstack/react-query';
import { Ban, Download, Plus, Upload, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  customersControllerExport,
  useCustomersControllerList,
  useCustomersControllerTags,
} from '@/api/generated/endpoints';
import type { CustomersControllerListParams } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, PageHeader, Pagination, SearchField, Table, Td, Th } from '@/components/ui/table';
import { useListParams } from '@/lib/use-list-params';
import { downloadCsv } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { useDebounced } from '@/lib/use-debounced';
import { formatMoney } from '@/lib/utils';
import { useCan, useShop } from '../shop-context';
import { failed } from '../settings/shared-utils';
import { CustomerFormDialog } from './customer-form';
import { ImportDialog } from './import-dialog';
import { relativeDays } from './format';

/** Clientes: búsqueda, filtros y página en la URL; alta, importación y exportación CSV. */
export function CustomersPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const shop = useShop();
  const can = useCan();
  const navigate = useNavigate();
  const L = useListParams(20);
  const debouncedQ = useDebounced(L.get('q').trim(), 300);
  const [dialog, setDialog] = useState<'new' | 'import' | null>(null);
  const [exporting, setExporting] = useState(false);
  const tags = useCustomersControllerTags();

  const params: CustomersControllerListParams = {
    page: L.page,
    pageSize: L.pageSize,
    q: debouncedQ || undefined,
    tag: L.get('tag') || undefined,
    blocked: (L.get('blocked') as 'true' | 'false' | '') || undefined,
    sort: (L.get('sort') as CustomersControllerListParams['sort']) || 'name',
  };
  const list = useCustomersControllerList(params, { query: { placeholderData: keepPreviousData } });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = (await customersControllerExport()) as unknown as string;
      downloadCsv(`clientes-${shop.barbershop.slug}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (e) {
      failed(e);
    } finally {
      setExporting(false);
    }
  };

  const filtered = !!(debouncedQ || params.tag || params.blocked);
  const data = list.data;

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('nav.customers')}
        subtitle={data ? `${data.total.toLocaleString(locale)} ${filtered ? 'encontrados' : 'clientes en total'}` : undefined}
        actions={
          <>
            {can('customers.export') && (
              <Button variant="outline" loading={exporting} onClick={() => void exportCsv()}><Download aria-hidden /> Exportar</Button>
            )}
            {can('customers.manage') && (
              <>
                <Button variant="outline" onClick={() => setDialog('import')}><Upload aria-hidden /> Importar</Button>
                <Button onClick={() => setDialog('new')}><Plus aria-hidden /> Nuevo cliente</Button>
              </>
            )}
          </>
        }
      />

      <FilterBar>
        <SearchField value={L.get('q')} onChange={(e) => L.set({ q: e.target.value })} placeholder="Nombre, teléfono o email" label="Buscar clientes" />
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <Select aria-label="Etiqueta" className="min-w-0 sm:w-44" value={params.tag ?? ''} onChange={(e) => L.set({ tag: e.target.value })}>
            <option value="">Etiquetas</option>
            {tags.data?.map((x) => <option key={x.tag} value={x.tag}>{x.tag} ({x.count})</option>)}
          </Select>
          <Select aria-label="Estado" className="min-w-0 sm:w-36" value={params.blocked ?? ''} onChange={(e) => L.set({ blocked: e.target.value })}>
            <option value="">Todos</option>
            <option value="false">Activos</option>
            <option value="true">Bloqueados</option>
          </Select>
          <Select aria-label="Orden" className="min-w-0 sm:w-44" value={params.sort} onChange={(e) => L.set({ sort: e.target.value === 'name' ? '' : e.target.value })}>
            <option value="name">Nombre (A–Z)</option>
            <option value="-lastVisitAt">Última visita</option>
            <option value="-createdAt">Más recientes</option>
          </Select>
        </div>
      </FilterBar>

      {list.error ? (
        <Alert title={errorMessage(list.error, t)} />
      ) : !data ? (
        <Skeleton className="h-96" />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'Ningún cliente coincide' : 'Aún no tienes clientes'}
          description={filtered ? 'Prueba con otra búsqueda o quita los filtros.' : 'Se crean solos con cada reserva. También puedes agregarlos a mano o importar un CSV.'}
          action={!filtered && can('customers.manage') ? <Button onClick={() => setDialog('import')}><Upload aria-hidden /> Importar CSV</Button> : undefined}
        />
      ) : (
        <>
          {/* Móvil: tarjetas. Escritorio: tabla. */}
          <ul className="grid gap-2 sm:hidden">
            {data.items.map((c) => (
              <li key={c.id}>
                <Link to={c.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <span className="grid min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium">{c.isBlocked && <Ban className="size-3.5 text-destructive" aria-label="Bloqueado" />}{c.fullName}</span>
                    <span className="truncate text-sm text-muted-foreground tabular-nums">{formatPhone(c.phone) ?? 'Sin teléfono'}</span>
                  </span>
                  <span className="grid text-right text-sm">
                    <span className="tabular-nums">{c.stats.visits} visitas</span>
                    <span className="text-muted-foreground">{relativeDays(c.stats.lastVisitAt, locale) ?? '—'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Teléfono</Th>
                  <Th className="text-right">Visitas</Th>
                  <Th>Última visita</Th>
                  <Th className="text-right">Gastado</Th>
                  <Th>Etiquetas</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => navigate(c.id)}>
                    <Td>
                      <Link to={c.id} className="flex items-center gap-2 font-medium text-slate-900 hover:text-marca-700" onClick={(e) => e.stopPropagation()}>
                        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        {c.fullName}
                      </Link>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {c.isBlocked && <Badge tone="danger"><Ban className="mr-1 size-3" aria-hidden />Bloqueado</Badge>}
                        {c.noShowCount > 0 && <Badge tone="warning">{c.noShowCount} inasistencia{c.noShowCount > 1 ? 's' : ''}</Badge>}
                      </span>
                    </Td>
                    <Td className="tabular-nums whitespace-nowrap">{formatPhone(c.phone) ?? <span className="text-muted-foreground">—</span>}</Td>
                    <Td className="text-right tabular-nums">{c.stats.visits}</Td>
                    <Td className="whitespace-nowrap">{relativeDays(c.stats.lastVisitAt, locale) ?? <span className="text-muted-foreground">Nunca</span>}</Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">{formatMoney(c.stats.totalSpentCents, shop.barbershop.currency, locale)}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">{c.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}

      {dialog === 'new' && <CustomerFormDialog onClose={() => setDialog(null)} onSaved={(c) => navigate(c.id)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
