import { PackageMinus, PackagePlus, Search, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { useInventoryControllerCreateMovements, useInventoryControllerList } from '@/api/generated/endpoints';
import type { ProductListDtoItemsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/use-debounced';
import { cn, formatMoney } from '@/lib/utils';
import { saved, useRefreshShop } from '../settings/shared-utils';
import { centsToInput, parseMoney } from './money';

type Line = { product: ProductListDtoItemsItem; quantity: string; cost: string };

/**
 * Ingreso de compra (entran unidades, con su costo) o ajuste por conteo (se escribe lo que hay
 * en el estante y se calcula la diferencia). Varios productos en un solo registro.
 */
export function MovementDialog({ kind, initial, onClose }: { kind: 'purchase' | 'adjustment'; initial?: ProductListDtoItemsItem; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const purchase = kind === 'purchase';
  const [lines, setLines] = useState<Line[]>(() => (initial ? [toLine(initial, purchase)] : []));
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const found = useInventoryControllerList({ q: dq, pageSize: 6, status: 'active' }, { query: { enabled: dq.length >= 2 } });
  const save = useInventoryControllerCreateMovements({
    mutation: {
      onSuccess: async (r) => {
        await refresh();
        saved(purchase ? `Compra registrada (${r.created} producto(s))` : r.created ? `Ajuste registrado (${r.created} producto(s))` : 'Sin diferencias: no hubo que ajustar nada');
        onClose();
      },
    },
  });
  const err: unknown = save.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};

  const add = (p: ProductListDtoItemsItem) => {
    if (!lines.some((l) => l.product.id === p.id)) setLines([...lines, toLine(p, purchase)]);
    setQ('');
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const invalid = lines.some((l) => (purchase ? !(Number(l.quantity) > 0) || (l.cost !== '' && parseMoney(l.cost) === null) : l.quantity === '' || Number(l.quantity) < 0));
  const total = purchase ? lines.reduce((n, l) => n + (Number(l.quantity) || 0) * (parseMoney(l.cost) ?? 0), 0) : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      data: {
        kind,
        note: note.trim() || null,
        items: lines.map((l) =>
          purchase
            ? { productId: l.product.id, quantity: Number(l.quantity), ...(l.cost ? { unitCostCents: parseMoney(l.cost)! } : {}) }
            : { productId: l.product.id, counted: Number(l.quantity) },
        ),
      },
    });
  };

  return (
    <Dialog open onClose={onClose} className="max-w-2xl"
      title={purchase ? 'Ingresar compra' : 'Ajuste de inventario'}
      description={purchase ? 'Suma unidades al stock de la sede principal. El costo actualiza el costo del producto.' : 'Escribe cuántas unidades hay realmente; se registra la diferencia con el sistema.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button>
          <Button type="submit" form="movement-form" loading={save.isPending} disabled={!lines.length || invalid || (!purchase && !note.trim())}>
            {purchase ? <PackagePlus aria-hidden /> : <PackageMinus aria-hidden />} {purchase ? 'Registrar compra' : 'Registrar ajuste'}
          </Button>
        </>
      }>
      <form id="movement-form" onSubmit={submit} className="grid gap-4">
        {err && !Object.keys(fe).length ? <Alert title={errorMessage(err, t)} /> : null}
        <div className="relative">
          <label className="relative block">
            <span className="sr-only">Agregar producto</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input className="pl-9" autoFocus={!initial} placeholder="Buscar producto por nombre, SKU o código de barras" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const first = found.data?.items[0]; if (first) add(first); } }} />
          </label>
          {q.trim().length >= 2 && dq === q.trim() && (found.data?.items.length ?? 0) > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {found.data!.items.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => add(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="grid flex-1"><span className="font-medium text-slate-900">{p.name}</span><span className="font-mono text-xs text-slate-500">{p.sku ?? p.barcode ?? '—'}</span></span>
                    <span className="text-xs text-slate-500 tabular-nums">Stock {p.stock}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Busca y agrega los productos {purchase ? 'que llegaron' : 'que contaste'}.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/80 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Producto</th>
                  <th className="px-3 py-2 text-right">En sistema</th>
                  <th className="px-3 py-2 text-right">{purchase ? 'Llegan' : 'Contado'}</th>
                  {purchase ? <th className="px-3 py-2 text-right">Costo unit. (S/)</th> : <th className="px-3 py-2 text-right">Diferencia</th>}
                  <th className="px-1 py-2"><span className="sr-only">Quitar</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => {
                  const diff = l.quantity === '' ? null : Number(l.quantity) - l.product.stock;
                  return (
                    <tr key={l.product.id}>
                      <td className="px-3 py-2"><span className="font-medium text-slate-900">{l.product.name}</span></td>
                      <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{l.product.stock}</td>
                      <td className="px-3 py-2 text-right">
                        <Input aria-label={`${purchase ? 'Cantidad que llega' : 'Cantidad contada'} de ${l.product.name}`} type="number" min={purchase ? 1 : 0} max={100000}
                          className="ml-auto h-9 w-24 text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                      </td>
                      {purchase ? (
                        <td className="px-3 py-2 text-right">
                          <Input aria-label={`Costo unitario de ${l.product.name}`} inputMode="decimal" className="ml-auto h-9 w-28 text-right" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} />
                        </td>
                      ) : (
                        <td className={cn('px-3 py-2 text-right font-medium tabular-nums', diff === null || diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-700' : 'text-red-700')}>
                          {diff === null ? '—' : diff > 0 ? `+${diff}` : diff}
                        </td>
                      )}
                      <td className="px-1 py-2">
                        <Button type="button" variant="ghost" size="icon" className="size-9 text-slate-400 hover:text-red-600" aria-label={`Quitar ${l.product.name}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 aria-hidden /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {purchase && total > 0 && <p className="text-right text-sm text-slate-500">Total de la compra: <strong className="text-slate-900 tabular-nums">{formatMoney(total)}</strong></p>}
        <Field label={purchase ? 'Nota (opcional)' : 'Motivo del ajuste'} error={fe.note}>
          {(p) => <Input {...p} required={!purchase} maxLength={300} placeholder={purchase ? 'Factura 001-123 · Distribuidora Lima' : 'Conteo mensual, producto dañado…'} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {!purchase && lines.some((l) => l.product.stock < 0) && <Badge tone="warning">Hay stock negativo en el sistema</Badge>}
      </form>
    </Dialog>
  );
}

function toLine(p: ProductListDtoItemsItem, purchase: boolean): Line {
  return { product: p, quantity: purchase ? '' : String(p.stock), cost: purchase ? centsToInput(p.costCents) : '' };
}
