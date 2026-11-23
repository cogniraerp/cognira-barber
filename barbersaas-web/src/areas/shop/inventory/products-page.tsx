import { keepPreviousData } from '@tanstack/react-query';
import { ArrowLeftRight, CircleAlert, PackageMinus, PackagePlus, PackageX, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useInventoryControllerCategories, useInventoryControllerList } from '@/api/generated/endpoints';
import type { InventoryControllerListParams, ProductListDtoItemsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { ActionMenu } from '@/components/ui/action-menu';
import { Select } from '@/components/ui/form';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, MobileCard, PageHeader, Pagination, SearchField, Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useDebounced } from '@/lib/use-debounced';
import { useListParams } from '@/lib/use-list-params';
import { cn, formatMoney } from '@/lib/utils';
import { useCan } from '../shop-context';
import { margin } from './money';
import { MovementDialog } from './movement-dialog';
import { ProductDialog } from './product-dialog';

type Dialogs = { type: 'product'; product?: ProductListDtoItemsItem } | { type: 'purchase' | 'adjustment'; product?: ProductListDtoItemsItem } | null;

/** Catálogo de productos con su stock; filtros y paginación en la URL. */
export function ProductsPage() {
  const can = useCan();
  const navigate = useNavigate();
  const L = useListParams(20);
  const dq = useDebounced(L.get('q').trim(), 300);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const categories = useInventoryControllerCategories();
  const params: InventoryControllerListParams = {
    page: L.page,
    pageSize: L.pageSize,
    q: dq || undefined,
    category: L.get('categoria') || undefined,
    status: (L.get('estado') as 'active' | 'inactive') || undefined,
    lowStock: L.get('stock') === 'bajo' ? 'true' : undefined,
    sort: (L.get('orden') as InventoryControllerListParams['sort']) || 'name',
  };
  const list = useInventoryControllerList(params, { query: { placeholderData: keepPreviousData } });
  const low = useInventoryControllerList({ lowStock: 'true', pageSize: 1 });
  const data = list.data;
  const manage = can('products.manage');
  const move = can('inventory.manage');
  const filtered = !!(dq || params.category || params.status || params.lowStock);

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Productos"
        subtitle={data ? `${data.total} producto${data.total === 1 ? '' : 's'}${filtered ? (data.total === 1 ? ' encontrado' : ' encontrados') : ''}` : undefined}
        actions={
          <>
            {move && <Button variant="outline" onClick={() => setDialog({ type: 'adjustment' })}><PackageMinus aria-hidden /> Ajuste</Button>}
            {move && <Button variant="outline" onClick={() => setDialog({ type: 'purchase' })}><PackagePlus aria-hidden /> Ingresar compra</Button>}
            {manage && <Button onClick={() => setDialog({ type: 'product' })}><Plus aria-hidden /> Nuevo producto</Button>}
          </>
        }
      />

      {(low.data?.total ?? 0) > 0 && params.lowStock !== 'true' && (
        <Alert tone="info" title={`${low.data!.total} producto(s) con stock bajo o agotado`}>
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => L.set({ stock: 'bajo' })}>Ver cuáles</button>
        </Alert>
      )}

      <FilterBar>
        <SearchField value={L.get('q')} onChange={(e) => L.set({ q: e.target.value })} placeholder="Nombre, SKU o código de barras" label="Buscar productos" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select aria-label="Categoría" className="min-w-0 sm:w-48" value={L.get('categoria')} onChange={(e) => L.set({ categoria: e.target.value })}>
            <option value="">Todas las categorías</option>
            {categories.data?.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}
          </Select>
          <Select aria-label="Stock" className="min-w-0 sm:w-40" value={L.get('stock')} onChange={(e) => L.set({ stock: e.target.value })}>
            <option value="">Todo el stock</option>
            <option value="bajo">Stock bajo</option>
          </Select>
          <Select aria-label="Estado" className="min-w-0 sm:w-36" value={L.get('estado')} onChange={(e) => L.set({ estado: e.target.value })}>
            <option value="">Activos e inactivos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </Select>
          <Select aria-label="Orden" className="min-w-0 sm:w-40" value={params.sort} onChange={(e) => L.set({ orden: e.target.value === 'name' ? '' : e.target.value })}>
            <option value="name">Nombre (A–Z)</option>
            <option value="stock">Menos stock</option>
            <option value="-createdAt">Más recientes</option>
          </Select>
        </div>
      </FilterBar>

      {list.error ? (
        <Alert title={errorMessage(list.error, i18n.t)} />
      ) : !data ? (
        <Skeleton className="h-96" />
      ) : data.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'Ningún producto coincide' : 'Aún no tienes productos'}
          description={filtered ? 'Prueba con otra búsqueda o quita los filtros.' : 'Registra lo que vendes en mostrador (ceras, shampoo, aceites…) para controlar su stock.'}
          action={!filtered && manage ? <Button onClick={() => setDialog({ type: 'product' })}><Plus aria-hidden /> Nuevo producto</Button> : undefined}
        />
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {data.items.map((p) => (
              <li key={p.id}>
                <MobileCard className="grid gap-2">
                  <span className="flex items-start justify-between gap-3">
                    <span className="grid min-w-0">
                      <span className="truncate font-medium text-slate-900">{p.name}</span>
                      <span className="truncate font-mono text-xs text-slate-500">{p.sku ?? p.barcode ?? 'Sin código'}</span>
                    </span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(p.priceCents)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-sm">
                    <StockBadge p={p} />
                    <span className="flex gap-1">
                      {move && <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'purchase', product: p })}>Compra</Button>}
                      {manage && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'product', product: p })}>Editar</Button>}
                    </span>
                  </span>
                </MobileCard>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table aria-busy={list.isFetching}>
              <thead>
                <tr>
                  <Th>Producto</Th><Th>Categoría</Th><Th className="text-right">Precio</Th><Th className="text-right">Costo</Th>
                  <Th className="text-right">Margen</Th><Th className="text-right">Stock</Th><Th>Estado</Th><Th className="text-right">Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => {
                  const mg = margin(p.priceCents, p.costCents);
                  return (
                    <tr key={p.id} className={cn(!p.isActive && 'opacity-60')}>
                      <Td>
                        <span className="grid">
                          <span className="font-medium text-slate-900">{p.name}</span>
                          <span className="font-mono text-xs text-slate-500">{[p.sku, p.barcode].filter(Boolean).join(' · ') || '—'}</span>
                        </span>
                      </Td>
                      <Td>{p.category ?? <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(p.priceCents)}</Td>
                      <Td className="text-right text-slate-500 tabular-nums">{formatMoney(p.costCents)}</Td>
                      <Td className={cn('text-right tabular-nums', mg !== null && mg < 20 ? 'text-amber-700' : 'text-slate-700')}>{mg === null ? '—' : `${mg} %`}</Td>
                      <Td className="text-right"><StockBadge p={p} /></Td>
                      <Td>{p.isActive ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
                      <Td className="text-right">
                        <span className="flex justify-end gap-1">
                          {manage && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'product', product: p })} aria-label={`Editar ${p.name}`}><Pencil aria-hidden /></Button>}
                          <ActionMenu label={`Más acciones de ${p.name}`} actions={[
                            { label: 'Ingresar compra', icon: <PackagePlus />, onSelect: () => setDialog({ type: 'purchase', product: p }), hidden: !move },
                            { label: 'Ajustar stock (conteo)', icon: <PackageMinus />, onSelect: () => setDialog({ type: 'adjustment', product: p }), hidden: !move },
                            { label: 'Ver movimientos', icon: <ArrowLeftRight />, onSelect: () => navigate(`../movimientos?producto=${p.id}`, { relative: 'path' }) },
                          ]} />
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}

      {dialog?.type === 'product' && <ProductDialog product={dialog.product} onClose={() => setDialog(null)} />}
      {(dialog?.type === 'purchase' || dialog?.type === 'adjustment') && <MovementDialog kind={dialog.type} initial={dialog.product} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Stock con su estado (icono + texto, nunca solo color). */
function StockBadge({ p }: { p: ProductListDtoItemsItem }) {
  const title = p.stocks.length > 1 ? p.stocks.map((s) => `${s.locationName}: ${s.quantity}`).join(' · ') : undefined;
  if (p.stock <= 0)
    return <Badge tone="danger" title={title}><PackageX className="mr-1 size-3" aria-hidden />Agotado</Badge>;
  if (p.isLow)
    return <Badge tone="warning" title={title}><CircleAlert className="mr-1 size-3" aria-hidden /><span className="tabular-nums">{p.stock}</span>&nbsp;· bajo</Badge>;
  return <span className="font-medium text-slate-900 tabular-nums" title={title}>{p.stock}</span>;
}
