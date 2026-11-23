import { useState } from 'react';
import { useProfileControllerGetGeneral, useProfileControllerUpdateGeneral } from '@/api/generated/endpoints';
import type { UpdateGeneralSettingsDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Field } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Section } from './shared';
import { failed, saved, useRefreshShop } from './shared-utils';

const ZONES = ['America/Lima', 'America/Bogota', 'America/Guayaquil', 'America/Mexico_City', 'America/Santiago', 'America/La_Paz', 'America/Argentina/Buenos_Aires', 'America/Caracas', 'America/New_York', 'Europe/Madrid'];

export function GeneralForm() {
  const g = useProfileControllerGetGeneral({ query: {} });
  if (!g.data) return <Skeleton className="h-64" />;
  return <GeneralEditor initial={g.data} />;
}

function GeneralEditor({ initial }: { initial: UpdateGeneralSettingsDto }) {
  const refresh = useRefreshShop();
  const save = useProfileControllerUpdateGeneral({ mutation: { onSuccess: async () => { await refresh(); saved(); }, onError: failed } });
  const [f, setF] = useState<UpdateGeneralSettingsDto>(initial);
  const set = (patch: Partial<UpdateGeneralSettingsDto>) => setF({ ...f, ...patch });
  return (
    <Section title="Preferencias generales">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Idioma">{(p) => <Select {...p} value={f.locale} onChange={(e) => set({ locale: e.target.value as 'es-PE' })}><option value="es-PE">Español (Perú)</option><option value="es">Español</option><option value="en">English</option></Select>}</Field>
        <Field label="Zona horaria">{(p) => <Select {...p} value={f.timezone} onChange={(e) => set({ timezone: e.target.value })}>{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}</Select>}</Field>
        <Field label="Moneda">{(p) => <Select {...p} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>{['PEN', 'USD', 'COP', 'CLP', 'MXN', 'BOB', 'EUR'].map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
        <Field label="Formato de hora">{(p) => <Select {...p} value={f.timeFormat} onChange={(e) => set({ timeFormat: e.target.value as '12h' })}><option value="12h">12 h (3:30 p. m.)</option><option value="24h">24 h (15:30)</option></Select>}</Field>
        <Field label="Formato de fecha">{(p) => <Select {...p} value={f.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as 'dd/MM/yyyy' })}><option value="dd/MM/yyyy">31/12/2027</option><option value="MM/dd/yyyy">12/31/2027</option><option value="yyyy-MM-dd">2027-12-31</option></Select>}</Field>
        <Field label="La semana empieza">{(p) => <Select {...p} value={f.weekStartsOn} onChange={(e) => set({ weekStartsOn: Number(e.target.value) as 1 })}><option value={1}>Lunes</option><option value={0}>Domingo</option></Select>}</Field>
      </div>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate({ data: f })}>Guardar</Button></div>
    </Section>
  );
}
