import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import {
  useInventoryControllerCategories,
  useInventoryControllerCreate,
  useInventoryControllerUpdate,
} from '@/api/generated/endpoints';
import type { ProductListDtoItemsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { saved, useRefreshShop } from '../settings/shared-utils';
import { centsToInput, margin, parseMoney } from './money';

/** Alta o edición de un producto. Precio y costo en soles; el stock se mueve con compras/ajustes. */
export function ProductDialog({ product, onClose }: { product?: ProductListDtoItemsItem; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const categories = useInventoryControllerCategories();
  const [f, setF] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    category: product?.category ?? '',
    description: product?.description ?? '',
    price: product ? centsToInput(product.priceCents) : '',
    cost: product ? centsToInput(product.costCents) : '',
    stockMin: String(product?.stockMin ?? 0),
    initialStock: '',
    isActive: product?.isActive ?? true,
  });
  const done = async () => { await refresh(); saved(product ? 'Producto actualizado' : 'Producto creado'); onClose(); };
  const create = useInventoryControllerCreate({ mutation: { onSuccess: done } });
  const update = useInventoryControllerUpdate({ mutation: { onSuccess: done } });
  const m = product ? update : create;
  const err: unknown = m.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};
  const priceCents = parseMoney(f.price);
  const costCents = f.cost ? parseMoney(f.cost) : 0;
  const mg = priceCents !== null && costCents !== null ? margin(priceCents, costCents) : null;
  const conflictField = isApiError(err, 'CONFLICT') ? (err.problem.field as string | undefined) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (priceCents === null || costCents === null) return;
    const data = {
      name: f.name.trim(),
      sku: f.sku.trim() || null,
      barcode: f.barcode.trim() || null,
      category: f.category.trim() || null,
      description: f.description.trim() || null,
      priceCents,
      costCents,
      stockMin: Number(f.stockMin) || 0,
      isActive: f.isActive,
    };
    if (product) update.mutate({ id: product.id, data });
    else create.mutate({ data: { ...data, ...(f.initialStock ? { initialStock: Number(f.initialStock) } : {}) } });
  };

  return (
    <Dialog open onClose={onClose} title={product ? 'Editar producto' : 'Nuevo producto'} className="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button type="submit" form="product-form" loading={m.isPending}>{t('app.save')}</Button></>}>
      <form id="product-form" onSubmit={submit} className="grid gap-4">
        {err && !Object.keys(fe).length && !conflictField ? <Alert title={errorMessage(err, t)} /> : null}
        <Field label="Nombre" error={fe.name}>{(p) => <Input {...p} required minLength={2} maxLength={120} placeholder="Cera mate fijación fuerte 100 g" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Precio de venta (S/)" error={fe.priceCents ?? (f.price && priceCents === null ? 'Monto inválido' : undefined)}>
            {(p) => <Input {...p} required inputMode="decimal" placeholder="35.00" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}
          </Field>
          <Field label="Costo (S/)" error={fe.costCents ?? (f.cost && costCents === null ? 'Monto inválido' : undefined)} hint={mg !== null ? `Margen: ${mg} %` : undefined}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="18.00" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}
          </Field>
          <Field label="Stock mínimo" error={fe.stockMin} hint="Aviso de stock bajo">
            {(p) => <Input {...p} type="number" min={0} max={100000} value={f.stockMin} onChange={(e) => setF({ ...f, stockMin: e.target.value })} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Categoría" error={fe.category}>
            {(p) => (
              <>
                <Input {...p} list="product-categories" maxLength={60} placeholder="Ceras y pomadas" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
                <datalist id="product-categories">{categories.data?.map((c) => <option key={c.category} value={c.category} />)}</datalist>
              </>
            )}
          </Field>
          <Field label="SKU (opcional)" error={fe.sku ?? (conflictField === 'sku' ? errorMessage(err, t) : undefined)}>
            {(p) => <Input {...p} maxLength={40} className="font-mono" placeholder="CER-MAT-100" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} />}
          </Field>
          <Field label="Código de barras" error={fe.barcode ?? (conflictField === 'barcode' ? errorMessage(err, t) : undefined)}>
            {(p) => <Input {...p} maxLength={32} inputMode="numeric" className="font-mono" placeholder="7750000000011" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value.trim() })} />}
          </Field>
        </div>
        {!product && (
          <Field label="Stock inicial (opcional)" hint="Unidades que tienes hoy en la sede principal. Se registra como compra.">
            {(p) => <Input {...p} type="number" min={0} max={100000} className="sm:w-48" value={f.initialStock} onChange={(e) => setF({ ...f, initialStock: e.target.value })} />}
          </Field>
        )}
        <Field label="Descripción (opcional)">{(p) => <Textarea {...p} className="min-h-16" maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Checkbox label="Activo (se puede vender)" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Dialog>
  );
}
