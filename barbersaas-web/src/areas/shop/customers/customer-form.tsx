import { X } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { useCustomersControllerCreate, useCustomersControllerUpdate } from '@/api/generated/endpoints';
import type { CustomerDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { saved, useRefreshShop } from '../settings/shared-utils';

/** Alta o edición de un cliente. El teléfono se normaliza en la API (+51 por defecto). */
export function CustomerFormDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer?: CustomerDto;
  onClose: () => void;
  onSaved?: (c: CustomerDto) => void;
}) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [f, setF] = useState({
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    birthday: customer?.birthday ?? '',
    tags: customer?.tags ?? [],
    waOptIn: customer?.waOptIn ?? true,
  });
  const done = async (c: CustomerDto) => {
    await refresh();
    saved(customer ? 'Cliente actualizado' : 'Cliente creado');
    onSaved?.(c);
    onClose();
  };
  const create = useCustomersControllerCreate({ mutation: { onSuccess: done } });
  const update = useCustomersControllerUpdate({ mutation: { onSuccess: done } });
  const m = customer ? update : create;
  const err: unknown = m.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = {
      fullName: f.fullName.trim(),
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      birthday: f.birthday || null,
      tags: f.tags,
      waOptIn: f.waOptIn,
    };
    if (customer) update.mutate({ id: customer.id, data });
    else create.mutate({ data });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={customer ? 'Editar cliente' : 'Nuevo cliente'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button>
          <Button type="submit" form="customer-form" loading={m.isPending}>{t('app.save')}</Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="grid gap-4">
        {m.error && !Object.keys(fe).length ? <Alert title={errorMessage(m.error, t)} /> : null}
        <Field label="Nombre completo" error={fe.fullName}>
          {(p) => <Input {...p} required minLength={2} maxLength={120} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Teléfono" error={fe.phone} hint="Sin código, se asume Perú (+51).">
            {(p) => <Input {...p} type="tel" inputMode="tel" maxLength={25} value={f.phone} placeholder="987 654 321" onChange={(e) => setF({ ...f, phone: e.target.value })} />}
          </Field>
          <Field label="Email" error={fe.email}>
            {(p) => <Input {...p} type="email" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
          </Field>
        </div>
        <Field label="Cumpleaños" error={fe.birthday}>
          {(p) => <Input {...p} type="date" className="sm:w-48" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />}
        </Field>
        <TagsInput value={f.tags} onChange={(tags) => setF({ ...f, tags })} error={fe.tags} />
        <Checkbox label="Acepta recibir mensajes por WhatsApp (recordatorios)" checked={f.waOptIn} onChange={(e) => setF({ ...f, waOptIn: e.target.checked })} />
      </form>
    </Dialog>
  );
}

/** Etiquetas libres (vip, frecuente…): Enter o coma para agregar. */
export function TagsInput({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim().toLowerCase().replace(/,/g, '').slice(0, 30);
    if (tag && !value.includes(tag) && value.length < 20) onChange([...value, tag]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <Field label="Etiquetas" error={error} hint="Ej.: vip, frecuente, niño. Enter para agregar.">
      {(p) => (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
          {value.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {tag}
              <button type="button" className="rounded-full hover:text-destructive" aria-label={`Quitar ${tag}`} onClick={() => onChange(value.filter((x) => x !== tag))}>
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <input {...p} className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none" value={draft} maxLength={30}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} />
        </div>
      )}
    </Field>
  );
}
