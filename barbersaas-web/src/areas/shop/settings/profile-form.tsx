import { useState, type FormEvent } from 'react';
import { isApiError } from '@/api/errors';
import { useProfileControllerGetProfile, useProfileControllerUpdateProfile } from '@/api/generated/endpoints';
import type { ProfileDtoOutput } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Section } from './shared';
import { failed, saved, useRefreshShop } from './shared-utils';

/** Datos de la barbería + dirección de la sede principal. */
export function ProfileForm({ onSaved }: { onSaved?: () => void }) {
  const profile = useProfileControllerGetProfile({ query: {} });
  if (!profile.data) return <Skeleton className="h-96" />;
  return <ProfileEditor initial={profile.data} onSaved={onSaved} />;
}

/** Se monta con los datos ya cargados: el estado inicial sale de ellos (sin efectos que lo pisen). */
function ProfileEditor({ initial: p, onSaved }: { initial: ProfileDtoOutput; onSaved?: () => void }) {
  const refresh = useRefreshShop();
  const update = useProfileControllerUpdateProfile({ mutation: { onSuccess: async () => { await refresh(); saved(); onSaved?.(); }, onError: failed } });
  const [f, setF] = useState(() => ({
    name: p.name, description: p.description ?? '', category: p.category as string, phone: p.phone ?? '', email: p.email ?? '',
    legalName: p.legalName ?? '', taxId: p.taxId ?? '', address: p.address?.address ?? '', reference: p.address?.reference ?? '',
  }));
  const fe = isApiError(update.error) ? update.error.fieldErrors() : {};
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({
      data: {
        name: f.name, description: nul(f.description), category: f.category as 'barbershop', phone: nul(f.phone), email: nul(f.email),
        legalName: nul(f.legalName), taxId: nul(f.taxId), address: { address: nul(f.address), reference: nul(f.reference) },
      },
    });
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Section title="Datos de la barbería" description="Se muestran en tu página de reservas.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" error={fe.name}>{(p) => <Input {...p} required value={f.name} onChange={set('name')} />}</Field>
          <Field label="Tipo">{(p) => <Select {...p} value={f.category} onChange={set('category')}><option value="barbershop">Barbería</option><option value="salon">Salón</option><option value="spa">Spa</option></Select>}</Field>
          <div className="sm:col-span-2"><Field label="Descripción" error={fe.description}>{(p) => <Textarea {...p} value={f.description} onChange={set('description')} maxLength={1000} placeholder="Cortes clásicos y modernos desde 1998…" />}</Field></div>
          <Field label="Teléfono / WhatsApp" error={fe.phone}>{(p) => <Input {...p} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="+51 987 654 321" />}</Field>
          <Field label="Email de contacto" error={fe.email}>{(p) => <Input {...p} type="email" value={f.email} onChange={set('email')} />}</Field>
        </div>
      </Section>
      <Section title="Dirección" description="Dirección de la sede principal (aparece en el mapa y en los mensajes).">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dirección" error={fe['address.address']}>{(p) => <Input {...p} value={f.address} onChange={set('address')} placeholder="Av. José Larco 412, Miraflores" />}</Field>
          <Field label="Referencia" error={fe['address.reference']}>{(p) => <Input {...p} value={f.reference} onChange={set('reference')} placeholder="Frente al parque Kennedy" />}</Field>
        </div>
      </Section>
      <Section title="Datos fiscales" description="Opcional.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Razón social" error={fe.legalName}>{(p) => <Input {...p} value={f.legalName} onChange={set('legalName')} />}</Field>
          <Field label="RUC" error={fe.taxId} hint="11 dígitos">{(p) => <Input {...p} inputMode="numeric" value={f.taxId} onChange={set('taxId')} maxLength={11} />}</Field>
        </div>
      </Section>
      <div className="flex justify-end"><Button type="submit" loading={update.isPending}>Guardar</Button></div>
    </form>
  );
}
