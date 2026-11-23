import { keepPreviousData } from '@tanstack/react-query';
import { Ban, CircleCheck, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useSalesControllerList } from '@/api/generated/endpoints';
import type { SalesControllerListParams } from '@/api/generated/model';
import { buttonVariants } from '@/components/ui/button-variants';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, MobileCard, PageHeader, Pagination, SearchField, Table, Td, Th } from '@/components/ui/table';
import { fromWall, parseWall } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useDebounced } from '@/lib/use-debounced';
import { useListParams } from '@/lib/use-list-params';
import { cn, formatMoney } from '@/lib/utils';
import { ALL_METHODS, METHOD, type Method } from '../cash/methods';
import { useShop } from '../shop-context';
import { SaleDialog } from './sale-dialog';

/** Ventas: búsqueda por número o cliente, filtros, resumen del período y detalle con anulación. */
export function SalesPage() {
  const tz = useShop().barbershop.timezone;
  const L = useListParams(20);
  const dq = useDebounced(L.get('q').trim(), 300);
  const desde = L.get('desde');
  const hasta = L.get('hasta');
  const params: SalesControllerListParams = {
    page: L.page,
    pageSize: L.pageSize,
    q: dq || undefined,
    status: (L.get('estado') as 'completed' | 'voided') || undefined,
    method: (L.get('metodo') as Method) || undefined,
    from: desde ? fromWall(parseWall(desde, '00:00'), tz) : undefined,
    to: hasta ? fromWall(parseWall(hasta, '23:59'), tz) : undefined,
  };
  const list = useSalesControllerList(params, { query: { placeholderData: keepPreviousData } });
  const open = L.get('venta');
  const data = list.data;
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: tz });

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Ventas"
        subtitle={data ? `${data.summary.count} cobrada${data.summary.count === 1 ? '' : 's'} · ${formatMoney(data.summary.totalCents)}${data.summary.tipCents ? ` · propinas ${formatMoney(data.summary.tipCents)}` : ''}` : undefined}
        actions={<Link to="../cobrar" relative="path" className={buttonVariants()}><Plus aria-hidden /> Nueva venta</Link>}
      />
      <FilterBar>
        <SearchField value={L.get('q')} onChange={(e) => L.set({ q: e.target.value })} placeholder="Nº de venta (V-000123) o cliente" label="Buscar ventas" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select aria-label="Estado" className="min-w-0 sm:w-40" value={L.get('estado')} onChange={(e) => L.set({ estado: e.target.value })}>
            <option value="">Todas</option><option value="completed">Cobradas</option><option value="voided">Anuladas</option>
          </Select>
          <Select aria-label="Método" className="min-w-0 sm:w-44" value={L.get('metodo')} onChange={(e) => L.set({ metodo: e.target.value })}>
            <option value="">Todos los métodos</option>
            {ALL_METHODS.map((m) => <option key={m} value={m}>{METHOD[m].label}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-500">Desde<Input type="date" className="w-auto" value={desde} onChange={(e) => L.set({ desde: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-500">Hasta<Input type="date" className="w-auto" value={hasta} onChange={(e) => L.set({ hasta: e.target.value })} /></label>
      </FilterBar>

      {list.error ? <Alert title={errorMessage(list.error, i18n.t)} /> : !data ? <Skeleton className="h-96" /> : data.items.length === 0 ? (
        <EmptyState title="Sin ventas" description="Las ventas cobradas en caja aparecerán aquí." />
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {data.items.map((s) => (
              <li key={s.id}>
                <button type="button" className="w-full text-left" onClick={() => L.set({ venta: s.id, page: String(L.page) })}>
                  <MobileCard className={cn('grid gap-1 text-sm', s.status === 'voided' && 'opacity-60')}>
                    <span className="flex justify-between gap-2"><span className="font-mono font-medium">{s.code}</span><span className="font-semibold tabular-nums">{formatMoney(s.totalCents)}</span></span>
                    <span className="truncate text-slate-500">{fmt.format(new Date(s.createdAt))} · {s.customer?.fullName ?? 'Sin cliente'}</span>
                  </MobileCard>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table aria-busy={list.isFetching}>
              <thead><tr><Th>Nº</Th><Th>Fecha</Th><Th>Cliente</Th><Th>Detalle</Th><Th>Atendió</Th><Th>Pago</Th><Th className="text-right">Total</Th><Th>Estado</Th></tr></thead>
              <tbody>
                {data.items.map((s) => {
                  const staff = [...new Set(s.items.map((i) => i.staff?.displayName).filter(Boolean))];
                  return (
                    <tr key={s.id} className={cn('cursor-pointer', s.status === 'voided' && 'text-slate-400')} onClick={() => L.set({ venta: s.id, page: String(L.page) })}>
                      <Td><button type="button" className="font-mono font-medium text-marca-700 hover:underline">{s.code}</button></Td>
                      <Td className="whitespace-nowrap text-slate-500">{fmt.format(new Date(s.createdAt))}</Td>
                      <Td>{s.customer?.fullName ?? <span className="text-slate-400">—</span>}</Td>
                      <Td className="max-w-64 truncate">{s.items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name)).join(', ')}</Td>
                      <Td className="text-slate-500">{staff.join(', ') || '—'}</Td>
                      <Td>
                        <span className="flex gap-1">
                          {s.payments.map((p, i) => {
                            const M = METHOD[p.method as Method];
                            return <span key={i} title={`${M.label} ${formatMoney(p.amountCents)}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"><M.icon className="size-3" aria-hidden />{M.label}</span>;
                          })}
                        </span>
                      </Td>
                      <Td className={cn('text-right font-semibold tabular-nums', s.status === 'voided' ? 'line-through' : 'text-slate-900')}>{formatMoney(s.totalCents)}</Td>
                      <Td>{s.status === 'completed' ? <Badge tone="success"><CircleCheck className="mr-1 size-3" aria-hidden />Cobrada</Badge> : <Badge tone="danger"><Ban className="mr-1 size-3" aria-hidden />Anulada</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}
      {open && <SaleDialog id={open} onClose={() => L.set({ venta: null, page: String(L.page) })} />}
    </div>
  );
}
