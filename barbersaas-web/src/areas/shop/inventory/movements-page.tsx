import { keepPreviousData } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, PackageMinus, PackagePlus, RotateCcw, ShoppingBag, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { useInventoryControllerGet, useInventoryControllerMovements } from '@/api/generated/endpoints';
import type { InventoryControllerMovementsParams } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, MobileCard, PageHeader, Pagination, Table, Td, Th } from '@/components/ui/table';
import { fromWall, parseWall } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useListParams } from '@/lib/use-list-params';
import { cn, formatMoney } from '@/lib/utils';
import { useCan, useShop } from '../shop-context';
import { MovementDialog } from './movement-dialog';

const KIND = {
  purchase: { label: 'Compra', icon: PackagePlus, tone: 'success' as const },
  sale: { label: 'Venta', icon: ShoppingBag, tone: 'info' as const },
  adjustment: { label: 'Ajuste', icon: SlidersHorizontal, tone: 'warning' as const },
  return: { label: 'Devolución', icon: RotateCcw, tone: 'neutral' as const },
};

/** Libro de movimientos de inventario (no se editan: un error se corrige con un ajuste). */
export function MovementsPage() {
  const can = useCan();
  const tz = useShop().barbershop.timezone;
  const L = useListParams(20);
  const [dialog, setDialog] = useState<'purchase' | 'adjustment' | null>(null);
  const productId = L.get('producto') || undefined;
  const product = useInventoryControllerGet(productId ?? '', { query: { enabled: !!productId } });
  const desde = L.get('desde');
  const hasta = L.get('hasta');
  const params: InventoryControllerMovementsParams = {
    page: L.page,
    pageSize: L.pageSize,
    productId,
    kind: (L.get('tipo') as InventoryControllerMovementsParams['kind']) || undefined,
    from: desde ? fromWall(parseWall(desde, '00:00'), tz) : undefined,
    to: hasta ? fromWall(parseWall(hasta, '23:59'), tz) : undefined,
  };
  const list = useInventoryControllerMovements(params, { query: { placeholderData: keepPreviousData } });
  const data = list.data;
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Movimientos de inventario"
        subtitle="Compras, ventas, ajustes y devoluciones. Cada fila muestra el saldo que quedó."
        actions={
          can('inventory.manage') && (
            <>
              <Button variant="outline" onClick={() => setDialog('adjustment')}><PackageMinus aria-hidden /> Ajuste</Button>
              <Button onClick={() => setDialog('purchase')}><PackagePlus aria-hidden /> Ingresar compra</Button>
            </>
          )
        }
      />
      <FilterBar>
        {productId && (
          <Badge tone="info" className="h-11 gap-2 rounded-lg px-3 text-sm">
            {product.data?.name ?? 'Producto'}
            <button type="button" aria-label="Quitar filtro de producto" onClick={() => L.set({ producto: null })}><X className="size-4" aria-hidden /></button>
          </Badge>
        )}
        <Select aria-label="Tipo" className="sm:w-44" value={L.get('tipo')} onChange={(e) => L.set({ tipo: e.target.value })}>
          <option value="">Todos los tipos</option>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-500">Desde<Input type="date" className="w-auto" value={desde} onChange={(e) => L.set({ desde: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-500">Hasta<Input type="date" className="w-auto" value={hasta} onChange={(e) => L.set({ hasta: e.target.value })} /></label>
      </FilterBar>

      {list.error ? (
        <Alert title={errorMessage(list.error, i18n.t)} />
      ) : !data ? (
        <Skeleton className="h-96" />
      ) : data.items.length === 0 ? (
        <EmptyState title="Sin movimientos" description="Aquí aparecerán las compras, ventas y ajustes de stock." />
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {data.items.map((m) => {
              const K = KIND[m.kind];
              return (
                <li key={m.id}>
                  <MobileCard className="grid gap-1 text-sm">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-900">{m.product.name}</span>
                      <Qty q={m.quantity} />
                    </span>
                    <span className="flex items-center justify-between gap-2 text-slate-500">
                      <Badge tone={K.tone}><K.icon className="mr-1 size-3" aria-hidden />{K.label}</Badge>
                      <span>{fmt.format(new Date(m.createdAt))} · saldo {m.balance}</span>
                    </span>
                    {m.note && <span className="text-slate-500">{m.note}</span>}
                  </MobileCard>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <Table aria-busy={list.isFetching}>
              <thead>
                <tr><Th>Fecha</Th><Th>Producto</Th><Th>Tipo</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Saldo</Th><Th className="text-right">Costo unit.</Th><Th>Nota</Th><Th>Registró</Th></tr>
              </thead>
              <tbody>
                {data.items.map((m) => {
                  const K = KIND[m.kind];
                  return (
                    <tr key={m.id}>
                      <Td className="whitespace-nowrap text-slate-500">{fmt.format(new Date(m.createdAt))}</Td>
                      <Td>
                        <span className="grid">
                          <span className="font-medium text-slate-900">{m.product.name}</span>
                          {m.product.sku && <span className="font-mono text-xs text-slate-500">{m.product.sku}</span>}
                        </span>
                      </Td>
                      <Td><Badge tone={K.tone}><K.icon className="mr-1 size-3" aria-hidden />{K.label}</Badge></Td>
                      <Td className="text-right"><Qty q={m.quantity} /></Td>
                      <Td className="text-right font-medium text-slate-900 tabular-nums">{m.balance}</Td>
                      <Td className="text-right text-slate-500 tabular-nums">{m.unitCostCents === null ? '—' : formatMoney(m.unitCostCents)}</Td>
                      <Td className="max-w-64 truncate text-slate-500" title={m.note ?? undefined}>{m.note ?? '—'}</Td>
                      <Td className="text-slate-500">{m.createdBy ?? '—'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}
      {dialog && <MovementDialog kind={dialog} initial={product.data} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** +12 (entra) / −8 (sale), con flecha además del color. */
function Qty({ q }: { q: number }) {
  const In = q > 0;
  const Icon = In ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className={cn('inline-flex items-center gap-1 font-semibold tabular-nums', In ? 'text-emerald-700' : 'text-red-700')}>
      <Icon className="size-3.5" aria-label={In ? 'entra' : 'sale'} />
      {In ? `+${q}` : `−${Math.abs(q)}`}
    </span>
  );
}
