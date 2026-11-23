import { Download, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { isApiError } from '@/api/errors';
import {
  useLocationsControllerAddException,
  useLocationsControllerAddHoliday,
  useLocationsControllerExceptions,
  useLocationsControllerGetHours,
  useLocationsControllerHolidays,
  useLocationsControllerImportPeru,
  useLocationsControllerList,
  useLocationsControllerRemoveException,
  useLocationsControllerRemoveHoliday,
  useLocationsControllerSetHours,
} from '@/api/generated/endpoints';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Badge, Skeleton } from '@/components/ui/misc';
import { Section, WeekEditor } from './shared';
import { failed, saved, toApiWeek, useRefreshShop, weekErrors, type Day } from './shared-utils';

const fmtDay = (iso: string) => new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** Horario semanal de la sede principal. */
export function HoursForm({ onSaved }: { onSaved?: () => void }) {
  const locations = useLocationsControllerList({ query: {} });
  const loc = locations.data?.find((l) => l.isPrimary) ?? locations.data?.[0];
  const hours = useLocationsControllerGetHours(loc?.id ?? '', { query: { enabled: Boolean(loc) } });
  if (!hours.data || !loc) return <Skeleton className="h-96" />;
  return <HoursEditor locationId={loc.id} initial={hours.data.days} onSaved={onSaved} />;
}

function HoursEditor({ locationId, initial, onSaved }: { locationId: string; initial: Day[]; onSaved?: () => void }) {
  const refresh = useRefreshShop();
  const [days, setDays] = useState<Day[]>(initial);
  const [sent, setSent] = useState<Array<{ dayOfWeek: number }>>([]);
  const save = useLocationsControllerSetHours({ mutation: { onSuccess: async () => { await refresh(); saved('Horario guardado'); onSaved?.(); } } });
  const errors = isApiError(save.error) ? weekErrors(save.error.fieldErrors(), sent) : {};

  const quick = (blocks: Day['blocks'], dows: number[]) => setDays([0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, blocks: dows.includes(d) ? blocks : [] })));
  return (
    <Section
      title="Horario de atención"
      description="Puedes partir el día en varios bloques (p. ej. 9:00–13:00 y 15:00–21:00). Los barberos trabajan este horario salvo que les configures uno propio."
      actions={
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={() => quick([{ start: '09:00', end: '21:00' }], [1, 2, 3, 4, 5, 6])}>Lun–Sáb 9–21</Button>
          <Button variant="outline" size="sm" onClick={() => quick([{ start: '09:00', end: '13:00' }, { start: '15:00', end: '21:00' }], [1, 2, 3, 4, 5, 6])}>Con almuerzo</Button>
        </div>
      }
    >
      <WeekEditor days={days} onChange={setDays} errors={errors} />
      {save.error && !Object.keys(errors).length ? <p role="alert" className="text-sm text-destructive">No se pudo guardar el horario.</p> : null}
      <div className="flex justify-end">
        <Button
          loading={save.isPending}
          onClick={() => {
            const week = toApiWeek(days);
            setSent(week);
            save.mutate({ id: locationId, data: { days: week } });
          }}
        >
          Guardar horario
        </Button>
      </div>
    </Section>
  );
}

export function HolidaysSection() {
  const year = new Date().getFullYear();
  const [y, setY] = useState(year);
  const refresh = useRefreshShop();
  const list = useLocationsControllerHolidays({ year: y }, { query: {} });
  const importPe = useLocationsControllerImportPeru({ mutation: { onSuccess: async (r) => { await refresh(); saved(`${r.created} feriados importados${r.skipped ? ` (${r.skipped} ya estaban)` : ''}`); }, onError: failed } });
  const add = useLocationsControllerAddHoliday({ mutation: { onSuccess: async () => { await refresh(); setForm({ date: '', name: '' }); }, onError: failed } });
  const remove = useLocationsControllerRemoveHoliday({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const [form, setForm] = useState({ date: '', name: '' });

  return (
    <Section
      title="Feriados"
      description="Esos días la barbería no recibe reservas. Los días no laborables que decreta el gobierno se agregan a mano."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setY(y - 1)} aria-label="Año anterior">‹</Button>
          <span className="tabular-nums">{y}</span>
          <Button variant="ghost" size="sm" onClick={() => setY(y + 1)} aria-label="Año siguiente">›</Button>
          <Button variant="outline" size="sm" loading={importPe.isPending} onClick={() => importPe.mutate({ data: { year: y } })}><Download aria-hidden /> Feriados de Perú {y}</Button>
        </div>
      }
    >
      {!list.data ? <Skeleton className="h-24" /> : list.data.length === 0 ? <p className="text-sm text-muted-foreground">Sin feriados en {y}.</p> : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {list.data.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
              <span><span className="tabular-nums">{fmtDay(h.date)}</span> · {h.name} {h.source === 'pe_national' && <Badge>Nacional</Badge>}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => remove.mutate({ id: h.id })} aria-label={`Quitar ${h.name}`}><Trash2 aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate({ data: { date: form.date, name: form.name } }); }}>
        <Field label="Fecha">{(p) => <Input {...p} type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
        <Field label="Motivo">{(p) => <Input {...p} required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Aniversario de la barbería" />}</Field>
        <Button type="submit" variant="outline" loading={add.isPending}><Plus aria-hidden /> Agregar</Button>
      </form>
    </Section>
  );
}

export function ExceptionsSection() {
  const locations = useLocationsControllerList({ query: {} });
  const loc = locations.data?.find((l) => l.isPrimary) ?? locations.data?.[0];
  const today = new Date().toISOString().slice(0, 10);
  const list = useLocationsControllerExceptions({ from: today }, { query: {} });
  const refresh = useRefreshShop();
  const add = useLocationsControllerAddException({ mutation: { onSuccess: async () => { await refresh(); saved(); }, onError: failed } });
  const remove = useLocationsControllerRemoveException({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const [f, setF] = useState({ date: '', isClosed: true, opensAt: '09:00', closesAt: '14:00', reason: '' });
  if (!loc) return null;
  return (
    <Section title="Días especiales" description="Un día con horario distinto (p. ej. Nochebuena 9:00–15:00) o cerrado por algo puntual.">
      {list.data && list.data.length > 0 && (
        <ul className="grid gap-1">
          {list.data.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
              <span><span className="tabular-nums">{fmtDay(x.date)}</span> · {x.isClosed ? 'Cerrado' : `${x.opensAt}–${x.closesAt}`}{x.reason ? ` · ${x.reason}` : ''}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => remove.mutate({ id: x.id })} aria-label="Quitar día especial"><Trash2 aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ data: { locationId: loc.id, date: f.date, isClosed: f.isClosed, ...(f.isClosed ? {} : { opensAt: f.opensAt, closesAt: f.closesAt }), reason: f.reason || undefined } });
        }}
      >
        <Field label="Fecha">{(p) => <Input {...p} type="date" required min={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Checkbox label="Cerrado todo el día" checked={f.isClosed} onChange={(e) => setF({ ...f, isClosed: e.target.checked })} className="pb-2.5" />
        {!f.isClosed && (
          <>
            <Field label="Abre">{(p) => <Input {...p} type="time" value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} />}</Field>
            <Field label="Cierra">{(p) => <Input {...p} type="time" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} />}</Field>
          </>
        )}
        <Field label="Motivo (opcional)">{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <Button type="submit" variant="outline" loading={add.isPending}><Plus aria-hidden /> Agregar</Button>
      </form>
    </Section>
  );
}
