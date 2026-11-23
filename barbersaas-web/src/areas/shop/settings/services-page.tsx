import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { isApiError } from '@/api/errors';
import {
  useServicesControllerCategories,
  useServicesControllerCreate,
  useServicesControllerCreateCategory,
  useServicesControllerList,
  useServicesControllerRemove,
  useServicesControllerRemoveCategory,
  useServicesControllerReorder,
  useServicesControllerUpdate,
  useStaffControllerList,
} from '@/api/generated/endpoints';
import type { ServiceListDtoOutputItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { useShop } from '../shop-context';
import { DepositFields, depositLabel, type DepositRule } from './deposit-fields';
import { ImageUpload, Section } from './shared';
import { failed, saved, useRefreshShop } from './shared-utils';

export function ServicesPage() {
  return <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6"><h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Servicios</h1><ServicesManager /></div>;
}

/** Catálogo de servicios (lo usa también el onboarding). */
export function ServicesManager() {
  const shop = useShop();
  const refresh = useRefreshShop();
  const services = useServicesControllerList({ includeInactive: 'true' }, { query: {} });
  const categories = useServicesControllerCategories({ query: {} });
  const reorder = useServicesControllerReorder({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const removeCat = useServicesControllerRemoveCategory({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const createCat = useServicesControllerCreateCategory({ mutation: { onSuccess: async () => { await refresh(); setNewCat(''); }, onError: failed } });
  const [editing, setEditing] = useState<ServiceListDtoOutputItem | 'new' | null>(null);
  const [newCat, setNewCat] = useState('');
  if (!services.data || !categories.data) return <Skeleton className="h-64" />;

  const list = services.data;
  const move = (i: number, dir: -1 | 1) => {
    const ids = list.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate({ data: { ids } });
  };
  const catName = (id: string | null) => categories.data.find((c) => c.id === id)?.name;

  return (
    <div className="grid gap-4">
      <Section title="Servicios" description="El orden de esta lista es el de tu página de reservas." actions={<Button onClick={() => setEditing('new')}><Plus aria-hidden /> Nuevo servicio</Button>}>
        {list.length === 0 ? (
          <EmptyState title="Aún no tienes servicios" description="Agrega al menos uno (p. ej. Corte clásico, 30 min, S/ 35)." action={<Button onClick={() => setEditing('new')}><Plus aria-hidden /> Agregar servicio</Button>} />
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 p-3">
                <span className="flex flex-col">
                  <Button variant="ghost" size="icon" className="size-6" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${s.name}`}><ArrowUp aria-hidden /></Button>
                  <Button variant="ghost" size="icon" className="size-6" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Bajar ${s.name}`}><ArrowDown aria-hidden /></Button>
                </span>
                {s.imageUrl ? <img src={s.imageUrl} alt="" className="size-10 rounded-md object-cover" /> : null}
                <span className="grid min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {s.name}
                    {!s.isActive && <Badge>Inactivo</Badge>}
                    {s.isActive && !s.isOnlineBookable && <Badge tone="warning">Solo en local</Badge>}
                    {s.depositOverride && <Badge tone="info">Adelanto: {depositLabel(s.depositOverride as DepositRule)}</Badge>}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {s.durationMin} min · {formatMoney(s.priceCents, shop.barbershop.currency)}
                    {catName(s.categoryId) ? ` · ${catName(s.categoryId)}` : ''} · {s.staff.length} barbero{s.staff.length === 1 ? '' : 's'}
                  </span>
                </span>
                <Button variant="ghost" size="icon" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}><Pencil aria-hidden /></Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Categorías" description="Agrupan los servicios en la página de reservas (opcional).">
        <ul className="flex flex-wrap gap-2">
          {categories.data.map((c) => (
            <li key={c.id}><Badge className="gap-1 py-1 pr-1">{c.name} ({c.servicesCount})<button type="button" className="rounded-full p-0.5 hover:bg-background" onClick={() => removeCat.mutate({ id: c.id })} aria-label={`Eliminar categoría ${c.name}`}><Trash2 className="size-3" aria-hidden /></button></Badge></li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newCat.trim()) createCat.mutate({ data: { name: newCat.trim() } }); }}>
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nueva categoría (p. ej. Barba)" aria-label="Nueva categoría" className="max-w-xs" />
          <Button type="submit" variant="outline" loading={createCat.isPending}>Agregar</Button>
        </form>
      </Section>

      {editing && <ServiceDialog service={editing === 'new' ? null : editing} categories={categories.data} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceDialog({ service, categories, onClose }: { service: ServiceListDtoOutputItem | null; categories: Array<{ id: string; name: string }>; onClose: () => void }) {
  const refresh = useRefreshShop();
  const staff = useStaffControllerList({}, { query: {} });
  const done = async () => { await refresh(); saved(); onClose(); };
  const create = useServicesControllerCreate({ mutation: { onSuccess: done } });
  const update = useServicesControllerUpdate({ mutation: { onSuccess: done } });
  const remove = useServicesControllerRemove({ mutation: { onSuccess: done, onError: failed } });
  const m = service ? update : create;
  const [f, setF] = useState({
    name: service?.name ?? '', description: service?.description ?? '', imageUrl: service?.imageUrl ?? null,
    price: service ? String(service.priceCents / 100) : '', durationMin: String(service?.durationMin ?? 30),
    bufferBeforeMin: String(service?.bufferBeforeMin ?? 0), bufferAfterMin: String(service?.bufferAfterMin ?? 0),
    categoryId: service?.categoryId ?? '', isOnlineBookable: service?.isOnlineBookable ?? true, isActive: service?.isActive ?? true,
  });
  const onlinePayments = useShop().plan.features.onlinePayments;
  const [deposit, setDeposit] = useState<DepositRule | null>((service?.depositOverride as DepositRule | null | undefined) ?? null);
  const [staffIds, setStaffIds] = useState<string[] | null>(null);
  const chosen = staffIds ?? staff.data?.map((s) => s.id) ?? [];
  const fe = isApiError(m.error) ? m.error.fieldErrors() : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name, description: f.description || null, imageUrl: f.imageUrl, priceCents: Math.round(Number(f.price) * 100),
      durationMin: Number(f.durationMin), bufferBeforeMin: Number(f.bufferBeforeMin), bufferAfterMin: Number(f.bufferAfterMin),
      categoryId: f.categoryId || null, isOnlineBookable: f.isOnlineBookable, isActive: f.isActive,
      depositOverride: deposit,
    };
    if (service) update.mutate({ id: service.id, data: body });
    else create.mutate({ data: { ...body, staffIds: chosen } });
  };

  return (
    <Dialog open onClose={onClose} title={service ? `Editar ${service.name}` : 'Nuevo servicio'} className="max-w-xl"
      footer={<>
        {service && <Button variant="ghost" className="mr-auto text-destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: service.id })}><Trash2 aria-hidden /> Eliminar</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="service-form" loading={m.isPending}>Guardar</Button>
      </>}>
      <form id="service-form" onSubmit={submit} className="grid gap-4">
        {m.error && !Object.keys(fe).length ? <Alert title={errorMessage(m.error, i18n.t)} /> : null}
        <Field label="Nombre" error={fe.name}>{(p) => <Input {...p} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Corte clásico" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio (S/)" error={fe.priceCents}>{(p) => <Input {...p} type="number" min={0} step="0.50" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
          <Field label="Duración (min)" error={fe.durationMin}>{(p) => <Input {...p} type="number" min={5} max={600} step={5} required value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} />}</Field>
          <Field label="Preparación antes (min)" hint="Tiempo bloqueado antes">{(p) => <Input {...p} type="number" min={0} max={120} step={5} value={f.bufferBeforeMin} onChange={(e) => setF({ ...f, bufferBeforeMin: e.target.value })} />}</Field>
          <Field label="Limpieza después (min)" hint="Tiempo bloqueado después">{(p) => <Input {...p} type="number" min={0} max={120} step={5} value={f.bufferAfterMin} onChange={(e) => setF({ ...f, bufferAfterMin: e.target.value })} />}</Field>
        </div>
        <Field label="Categoría">{(p) => <Select {...p} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Descripción">{(p) => <Textarea {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} />}</Field>
        <ImageUpload kind="service" label="Imagen" value={f.imageUrl} onChange={(imageUrl) => setF({ ...f, imageUrl })} />
        <div className="grid gap-2">
          <Checkbox label="Se puede reservar en línea" checked={f.isOnlineBookable} onChange={(e) => setF({ ...f, isOnlineBookable: e.target.checked })} />
          {f.isOnlineBookable && onlinePayments && (
            <DepositFields inherit value={deposit} onChange={setDeposit} error={fe['depositOverride.value']} />
          )}
          <Checkbox label="Activo" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        </div>
        {!service && staff.data && staff.data.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">¿Quién lo realiza?</legend>
            {staff.data.map((s) => <Checkbox key={s.id} label={s.displayName} checked={chosen.includes(s.id)} onChange={(e) => setStaffIds(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))} />)}
            <p className="text-xs text-muted-foreground">Precios y duraciones por barbero se ajustan en Barberos.</p>
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}
