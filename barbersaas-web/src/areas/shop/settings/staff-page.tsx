import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { ConfigForm } from '../commissions/config-editor';
import type { Config } from '../commissions/rule-utils';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { isApiError } from '@/api/errors';
import {
  servicesControllerList,
  staffControllerSetServices,
  useServicesControllerList,
  useStaffControllerAddTimeOff,
  useStaffControllerCreate,
  useStaffControllerGetHours,
  useStaffControllerList,
  useStaffControllerListTimeOff,
  useStaffControllerRemove,
  useStaffControllerRemoveTimeOff,
  useStaffControllerServices,
  useStaffControllerSetHours,
  useStaffControllerSetServices,
  useStaffControllerUpdate,
  useCommissionsControllerGetConfig,
} from '@/api/generated/endpoints';
import type { StaffListDtoOutputItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { tzOffset } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { useCan, useShop } from '../shop-context';
import { ImageUpload, Section, WeekEditor } from './shared';
import { failed, saved, toApiWeek, useRefreshShop, weekErrors, type Day } from './shared-utils';

export function StaffPage() {
  return <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6"><h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Barberos</h1><StaffManager /></div>;
}

export function StaffManager() {
  const staff = useStaffControllerList({ includeInactive: 'true' }, { query: {} });
  const [editing, setEditing] = useState<StaffListDtoOutputItem | 'new' | null>(null);
  if (!staff.data) return <Skeleton className="h-64" />;
  return (
    <Section title="Equipo" description="Cada barbero tiene su perfil, horario, servicios y ausencias. El acceso al sistema se da en Usuarios." actions={<Button onClick={() => setEditing('new')}><Plus aria-hidden /> Nuevo barbero</Button>}>
      {staff.data.length === 0 ? (
        <EmptyState title="Agrega a tu equipo" description="Aunque trabajes solo, agrégate como barbero para recibir reservas." action={<Button onClick={() => setEditing('new')}><Plus aria-hidden /> Agregar barbero</Button>} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {staff.data.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setEditing(s)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/50">
                {s.photoUrl ? <img src={s.photoUrl} alt="" className="size-12 rounded-full object-cover" /> : <span className="grid size-12 place-items-center rounded-full bg-muted"><UserRound className="size-5" aria-hidden /></span>}
                <span className="grid min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">{s.displayName}{!s.isActive && <Badge>Inactivo</Badge>}</span>
                  <span className="truncate text-sm text-muted-foreground">{s.servicesCount} servicios{s.member ? ' · con acceso' : ''}{s.specialties.length ? ` · ${s.specialties.join(', ')}` : ''}</span>
                </span>
                <Pencil className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <StaffDialog staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onCreated={(s) => setEditing(s)} />}
    </Section>
  );
}

type Tab = 'perfil' | 'horario' | 'servicios' | 'ausencias' | 'comision';

function StaffDialog({ staff, onClose, onCreated }: { staff: StaffListDtoOutputItem | null; onClose: () => void; onCreated: (s: StaffListDtoOutputItem) => void }) {
  const [tab, setTab] = useState<Tab>('perfil');
  const canCommissions = useCan()('commissions.manage');
  const tabs: Array<[Tab, string]> = [['perfil', 'Perfil'], ['horario', 'Horario'], ['servicios', 'Servicios'], ['ausencias', 'Ausencias'], ...(canCommissions ? ([['comision', 'Comisión']] as Array<[Tab, string]>) : [])];
  return (
    <Dialog open onClose={onClose} title={staff ? staff.displayName : 'Nuevo barbero'} className="max-w-2xl">
      {staff && (
        <Tabs className="mb-4" idBase="barbero" label="Secciones del barbero" value={tab} onChange={setTab}
          items={tabs.map(([id, label]) => ({ id, label }))} />
      )}
      <TabPanel idBase="barbero" id={tab}>
        {tab === 'perfil' && <StaffProfile staff={staff} onClose={onClose} onCreated={onCreated} />}
        {tab === 'horario' && staff && <StaffHours staffId={staff.id} />}
        {tab === 'servicios' && staff && <StaffServices staffId={staff.id} />}
        {tab === 'ausencias' && staff && <StaffTimeOff staffId={staff.id} />}
        {tab === 'comision' && staff && <StaffCommission staffId={staff.id} />}
      </TabPanel>
    </Dialog>
  );
}

function StaffProfile({ staff, onClose, onCreated }: { staff: StaffListDtoOutputItem | null; onClose: () => void; onCreated: (s: StaffListDtoOutputItem) => void }) {
  const refresh = useRefreshShop();
  const create = useStaffControllerCreate({
    mutation: {
      onSuccess: async (s) => {
        // Caso habitual: el barbero nuevo hace todos los servicios activos (se ajusta en la pestaña Servicios).
        const services = await servicesControllerList({}).catch(() => []);
        if (services.length) {
          await staffControllerSetServices(s.id, { items: services.map((x) => ({ serviceId: x.id, priceCentsOverride: null, durationMinOverride: null })) }).catch(() => undefined);
        }
        await refresh();
        saved(services.length ? `Barbero creado con ${services.length} servicio(s). Revisa su horario.` : 'Barbero creado');
        onCreated(s as StaffListDtoOutputItem);
      },
    },
  });
  const update = useStaffControllerUpdate({ mutation: { onSuccess: async () => { await refresh(); saved(); } } });
  const remove = useStaffControllerRemove({ mutation: { onSuccess: async () => { await refresh(); onClose(); }, onError: failed } });
  const m = staff ? update : create;
  const [f, setF] = useState({
    displayName: staff?.displayName ?? '', bio: staff?.bio ?? '', photoUrl: staff?.photoUrl ?? null,
    specialties: staff?.specialties.join(', ') ?? '', instagram: staff?.socials.instagram ?? '', tiktok: staff?.socials.tiktok ?? '', isActive: staff?.isActive ?? true,
  });
  const fe = isApiError(m.error) ? m.error.fieldErrors() : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = {
      displayName: f.displayName, bio: f.bio || null, photoUrl: f.photoUrl,
      specialties: f.specialties.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10),
      socials: { instagram: f.instagram || null, tiktok: f.tiktok || null }, isActive: f.isActive,
    };
    if (staff) update.mutate({ id: staff.id, data });
    else create.mutate({ data });
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      {m.error && !Object.keys(fe).length ? <Alert title={errorMessage(m.error, i18n.t)} /> : null}
      <div className="flex flex-wrap items-start gap-4">
        <ImageUpload kind="staff" label="Foto" value={f.photoUrl} onChange={(photoUrl) => setF({ ...f, photoUrl })} />
        <div className="grid flex-1 gap-4">
          <Field label="Nombre visible" error={fe.displayName}>{(p) => <Input {...p} required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder="Carlos" />}</Field>
          <Field label="Especialidades" hint="Separadas por comas">{(p) => <Input {...p} value={f.specialties} onChange={(e) => setF({ ...f, specialties: e.target.value })} placeholder="Fade, Navaja, Diseños" />}</Field>
        </div>
      </div>
      <Field label="Presentación">{(p) => <Textarea {...p} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} maxLength={500} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Instagram">{(p) => <Input {...p} value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="@usuario" />}</Field>
        <Field label="TikTok">{(p) => <Input {...p} value={f.tiktok} onChange={(e) => setF({ ...f, tiktok: e.target.value })} placeholder="@usuario" />}</Field>
      </div>
      {staff && <Checkbox label="Activo (recibe reservas)" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />}
      {staff && !staff.member && <p className="text-sm text-muted-foreground">Sin acceso al sistema. <Link to="../configuracion/usuarios" className="underline">Invítalo desde Usuarios</Link> para que vea su agenda.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {staff && <Button variant="ghost" className="mr-auto text-destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: staff.id })}><Trash2 aria-hidden /> Eliminar</Button>}
        <Button type="submit" loading={m.isPending}>{staff ? 'Guardar' : 'Crear barbero'}</Button>
      </div>
    </form>
  );
}

function StaffHours({ staffId }: { staffId: string }) {
  const hours = useStaffControllerGetHours(staffId, { query: {} });
  if (!hours.data) return <Skeleton className="h-64" />;
  return <StaffHoursEditor staffId={staffId} initialInherit={hours.data.inheritsLocationHours} initialDays={hours.data.days} />;
}

function StaffHoursEditor({ staffId, initialInherit, initialDays }: { staffId: string; initialInherit: boolean; initialDays: Day[] }) {
  const refresh = useRefreshShop();
  const [inherit, setInherit] = useState(initialInherit);
  const [days, setDays] = useState<Day[]>(initialDays);
  const [sent, setSent] = useState<Array<{ dayOfWeek: number }>>([]);
  const save = useStaffControllerSetHours({ mutation: { onSuccess: async () => { await refresh(); saved('Horario guardado'); } } });
  const errors = isApiError(save.error) ? weekErrors(save.error.fieldErrors(), sent) : {};
  const submit = () => {
    const week = toApiWeek(inherit ? days.map((d) => ({ ...d, blocks: [] })) : days, true);
    setSent(week);
    save.mutate({ id: staffId, data: { inheritLocationHours: inherit, days: week } });
  };
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="sr-only">Tipo de horario</legend>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="inherit" checked={inherit} onChange={() => setInherit(true)} /> Trabaja el horario de la barbería</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="inherit" checked={!inherit} onChange={() => setInherit(false)} /> Tiene su propio horario</label>
      </fieldset>
      <p className="text-sm text-muted-foreground">{inherit ? 'Puedes agregar descansos (p. ej. almuerzo) dentro del horario de la barbería.' : 'Nunca podrá recibir reservas fuera del horario de la barbería.'}</p>
      <WeekEditor days={days} onChange={setDays} withBreaks errors={errors} disabledBlocks={inherit} />
      {save.error && !Object.keys(errors).length ? <Alert title={errorMessage(save.error, i18n.t)} /> : null}
      <div className="flex justify-end"><Button loading={save.isPending} onClick={submit}>Guardar horario</Button></div>
    </div>
  );
}

function StaffServices({ staffId }: { staffId: string }) {
  const all = useServicesControllerList({}, { query: {} });
  const mine = useStaffControllerServices(staffId, { query: {} });
  if (!all.data || !mine.data) return <Skeleton className="h-48" />;
  if (all.data.length === 0) return <EmptyState title="Primero crea servicios" />;
  return <StaffServicesEditor staffId={staffId} all={all.data} mine={mine.data} />;
}

type Svc = { id: string; name: string; priceCents: number; durationMin: number };
type Mine = { serviceId: string; priceCentsOverride: number | null; durationMinOverride: number | null };

function StaffServicesEditor({ staffId, all, mine }: { staffId: string; all: Svc[]; mine: Mine[] }) {
  const shop = useShop();
  const refresh = useRefreshShop();
  const save = useStaffControllerSetServices({ mutation: { onSuccess: async () => { await refresh(); saved(); }, onError: failed } });
  const [items, setItems] = useState<Record<string, { on: boolean; price: string; duration: string }>>(() =>
    Object.fromEntries(all.map((s) => {
      const m = mine.find((x) => x.serviceId === s.id);
      return [s.id, { on: Boolean(m), price: m?.priceCentsOverride != null ? String(m.priceCentsOverride / 100) : '', duration: m?.durationMinOverride != null ? String(m.durationMinOverride) : '' }];
    })),
  );
  const submit = () => save.mutate({ id: staffId, data: { items: Object.entries(items).filter(([, v]) => v.on).map(([serviceId, v]) => ({ serviceId, priceCentsOverride: v.price ? Math.round(Number(v.price) * 100) : null, durationMinOverride: v.duration ? Number(v.duration) : null })) } });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Deja vacío el precio o la duración para usar los del servicio. Útil si un barbero senior cobra más.</p>
      <ul className="divide-y rounded-lg border">
        {all.map((s) => {
          const v = items[s.id]!;
          const set = (patch: Partial<typeof v>) => setItems({ ...items, [s.id]: { ...v, ...patch } });
          return (
            <li key={s.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_7rem_7rem] sm:items-center">
              <Checkbox label={`${s.name} (${formatMoney(s.priceCents, shop.barbershop.currency)} · ${s.durationMin} min)`} checked={v.on} onChange={(e) => set({ on: e.target.checked })} />
              <Input aria-label={`Precio propio de ${s.name}`} type="number" min={0} step="0.5" placeholder="Precio S/" disabled={!v.on} value={v.price} onChange={(e) => set({ price: e.target.value })} />
              <Input aria-label={`Duración propia de ${s.name}`} type="number" min={5} step="5" placeholder="Minutos" disabled={!v.on} value={v.duration} onChange={(e) => set({ duration: e.target.value })} />
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={submit}>Guardar servicios</Button></div>
    </div>
  );
}

function StaffTimeOff({ staffId }: { staffId: string }) {
  const shop = useShop();
  const refresh = useRefreshShop();
  const now = new Date().toISOString();
  const list = useStaffControllerListTimeOff(staffId, { from: now }, { query: {} });
  const [f, setF] = useState({ kind: 'vacation', from: '', to: '', reason: '', allDay: true, fromTime: '09:00', toTime: '13:00' });
  const [conflict, setConflict] = useState<number | null>(null);
  const add = useStaffControllerAddTimeOff({ mutation: { onSuccess: async () => { await refresh(); setConflict(null); saved('Ausencia registrada'); } } });
  const remove = useStaffControllerRemoveTimeOff({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const tz = shop.barbershop.timezone;
  const fmt = (iso: string) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

  const submit = (ignoreConflicts = false) => {
    if (!f.from) return;
    const to = f.to || f.from;
    const off = tzOffset(new Date(`${f.from}T12:00:00Z`), tz);
    const startsAt = `${f.from}T${f.allDay ? '00:00' : f.fromTime}:00${off}`;
    const endsAt = f.allDay ? `${to}T23:59:59${off}` : `${to}T${f.toTime}:00${off}`;
    add.mutate(
      { id: staffId, data: { startsAt, endsAt, kind: f.kind as 'vacation', reason: f.reason || null, ignoreConflicts } },
      { onError: (e) => { if (isApiError(e) && Array.isArray(e.problem.conflicts)) setConflict(e.problem.conflicts.length); else failed(e); } },
    );
  };
  return (
    <div className="grid gap-4">
      {!list.data ? <Skeleton className="h-16" /> : list.data.length === 0 ? <p className="text-sm text-muted-foreground">Sin ausencias próximas.</p> : (
        <ul className="grid gap-1">
          {list.data.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
              <span><Badge>{x.kind === 'vacation' ? 'Vacaciones' : x.kind === 'absence' ? 'Ausencia' : 'Bloqueo'}</Badge> {fmt(x.startsAt)} → {fmt(x.endsAt)}{x.reason ? ` · ${x.reason}` : ''}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => remove.mutate({ id: staffId, timeOffId: x.id })} aria-label="Quitar ausencia"><Trash2 aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 rounded-lg border p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Tipo">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="vacation">Vacaciones</option><option value="absence">Ausencia</option><option value="block">Bloqueo</option></Select>}</Field>
          <Field label="Desde">{(p) => <Input {...p} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label="Hasta">{(p) => <Input {...p} type="date" min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        </div>
        <Checkbox label="Días completos" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} />
        {!f.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hora inicio">{(p) => <Input {...p} type="time" value={f.fromTime} onChange={(e) => setF({ ...f, fromTime: e.target.value })} />}</Field>
            <Field label="Hora fin">{(p) => <Input {...p} type="time" value={f.toTime} onChange={(e) => setF({ ...f, toTime: e.target.value })} />}</Field>
          </div>
        )}
        <Field label="Motivo (opcional)">{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        {conflict !== null && (
          <Alert title={`Hay ${conflict} cita(s) en ese rango`}>
            Las citas no se cancelan solas. <Button size="sm" variant="outline" className="mt-2" onClick={() => submit(true)}>Registrar igual</Button>
          </Alert>
        )}
        <div className="flex justify-end"><Button variant="outline" loading={add.isPending} disabled={!f.from} onClick={() => submit()}><Plus aria-hidden /> Agregar ausencia</Button></div>
      </div>
    </div>
  );
}

/** Pestaña "Comisión": la misma regla que se edita desde Negocio → Comisiones. */
function StaffCommission({ staffId }: { staffId: string }) {
  const q = useCommissionsControllerGetConfig(staffId);
  if (!q.data) return <Skeleton className="h-48" />;
  return <ConfigForm staffId={staffId} initial={q.data as Config} />;
}
