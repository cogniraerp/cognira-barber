import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './agenda.css';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, format, getDay, parse, startOfWeek } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Footprints, Lock, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer, type EventProps, type SlotInfo } from 'react-big-calendar';
import dndAddon, { type EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isApiError } from '@/api/errors';
import {
  getShopAppointmentsControllerListQueryKey,
  useLocationsControllerGetHours,
  useLocationsControllerList,
  useShopAppointmentsControllerList,
  useShopAppointmentsControllerListTimeOff,
  useShopAppointmentsControllerReschedule,
  useStaffControllerList,
} from '@/api/generated/endpoints';
import type { AgendaTimeOffListDtoItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Alert, Spinner } from '@/components/ui/misc';
import { formatTime, fromWall, parseWall, toWall, wallDate } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useShop } from '../shop-context';
import { saved } from '../settings/shared-utils';
import { useAgendaAccess, useAgendaRefresh, type Appt } from './agenda-utils';
import { AppointmentDialog } from './appointment-dialog';
import { BlockDialog, TimeOffDialog } from './block-dialog';
import { NewAppointmentDialog } from './new-appointment-dialog';
import { STATUS, TIME_OFF_LABEL, toneStyle } from './status';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales: { es, en: enUS },
});

type Ev =
  | { kind: 'appt'; id: string; title: string; start: Date; end: Date; resourceId: string; appt: Appt }
  | { kind: 'off'; id: string; title: string; start: Date; end: Date; resourceId: string; off: AgendaTimeOffListDtoItem };
type Res = { id: string; title: string };

// El addon solo se publica en CommonJS: según el bundler llega la función o `{ default: función }`.
const withDragAndDrop = (dndAddon as unknown as { default?: typeof dndAddon }).default ?? dndAddon;
const DnDCalendar = withDragAndDrop<Ev, Res>(Calendar);
const MOVABLE = ['pending', 'confirmed'];

const MESSAGES = {
  es: { date: 'Fecha', time: 'Hora', event: 'Cita', allDay: 'Todo el día', noEventsInRange: 'Sin citas en este rango.', showMore: (n: number) => `+${n} más` },
  en: { date: 'Date', time: 'Time', event: 'Appointment', allDay: 'All day', noEventsInRange: 'No appointments in this range.', showMore: (n: number) => `+${n} more` },
};

type Dialogs =
  | { type: 'appt'; id: string }
  | { type: 'off'; off: AgendaTimeOffListDtoItem }
  | { type: 'slot'; tab: 'appt' | 'block'; start?: Date; end?: Date; staffId?: string | null }
  | { type: 'walkin' }
  | { type: 'force'; id: string; startAt: string; staffId?: string; label: string };

/**
 * Agenda: día (columnas por barbero) o semana (un barbero o todos). Arrastrar mueve la cita
 * (avisa al cliente); hacer clic en un hueco crea cita o bloqueo. Todo se dibuja en la hora
 * de la barbería, no la del navegador.
 */
export function AgendaPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith('en') ? 'en' : 'es';
  const locale = lang === 'en' ? 'en-US' : 'es-PE';
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const access = useAgendaAccess();
  const qc = useQueryClient();
  const refresh = useAgendaRefresh();
  const [sp, setSp] = useSearchParams();
  const [dialog, setDialog] = useState<Dialogs | null>(null);

  const view = sp.get('v') === 'week' ? 'week' : 'day';
  const todayWall = toWall(new Date(), tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('d') ?? '') ? parseWall(sp.get('d')!, '00:00') : parseWall(wallDate(todayWall), '00:00');
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) if (v === null) next.delete(k); else next.set(k, v);
    setSp(next, { replace: true });
  };

  // Barberos visibles: quien solo ve lo suyo, solo a sí mismo.
  const staffQ = useStaffControllerList({});
  const allStaff = useMemo(() => (staffQ.data ?? []).filter((s) => s.isActive), [staffQ.data]);
  const visibleStaff = access.viewAll ? allStaff : allStaff.filter((s) => s.id === access.ownStaffId);
  // Día: todos (una columna por barbero). Semana: uno solo por defecto; "Todos" es explícito (b=all).
  const picked = sp.get('b');
  const filterStaff = !access.viewAll
    ? null
    : picked && visibleStaff.some((s) => s.id === picked)
      ? picked
      : view === 'week' && picked !== 'all' && visibleStaff.length > 1
        ? visibleStaff[0]!.id
        : null;
  const shown = filterStaff ? visibleStaff.filter((s) => s.id === filterStaff) : visibleStaff;

  const rangeStart = view === 'week' ? startOfWeek(date, { weekStartsOn: 1 }) : date;
  const rangeEnd = addDays(rangeStart, view === 'week' ? 7 : 1);
  const params = { from: fromWall(rangeStart, tz), to: fromWall(rangeEnd, tz), ...(filterStaff ? { staffId: filterStaff } : {}) };
  const appts = useShopAppointmentsControllerList(params, { query: { refetchInterval: 30_000 } });
  const offs = useShopAppointmentsControllerListTimeOff(params, { query: { refetchInterval: 60_000 } });

  const { min, max } = useWorkingRange(appts.data ?? [], tz);

  const nameOf = (id: string) => allStaff.find((s) => s.id === id)?.displayName ?? '';
  const showCanceled = sp.get('c') === '1';
  const events: Ev[] = [
    ...(appts.data ?? [])
      .filter((a) => showCanceled || a.status !== 'canceled')
      .map((a): Ev => ({
        kind: 'appt',
        id: a.id,
        title: a.customer?.fullName ?? 'Walk-in',
        start: toWall(a.startAt, tz),
        end: toWall(a.endAt, tz),
        resourceId: a.staff.id,
        appt: a,
      })),
    ...(offs.data ?? []).map((o): Ev => ({
      kind: 'off',
      id: o.id,
      title: o.reason ?? TIME_OFF_LABEL[o.kind],
      start: toWall(o.startsAt, tz),
      end: toWall(o.endsAt, tz),
      resourceId: o.staffId,
      off: o,
    })),
  ];
  const useResources = view === 'day' && shown.length > 1;

  const reschedule = useShopAppointmentsControllerReschedule();
  const move = (ev: Extract<Ev, { kind: 'appt' }>, start: Date, staffId: string | undefined, force = false) => {
    const startAt = fromWall(start, tz);
    const key = getShopAppointmentsControllerListQueryKey(params);
    const prev = qc.getQueryData<Appt[]>(key);
    // Optimista: la cita queda donde se soltó mientras responde la API.
    const dur = new Date(ev.appt.endAt).getTime() - new Date(ev.appt.startAt).getTime();
    qc.setQueryData<Appt[]>(key, (list) =>
      list?.map((a) =>
        a.id === ev.id
          ? { ...a, startAt, endAt: new Date(new Date(startAt).getTime() + dur).toISOString(), staff: staffId ? { id: staffId, displayName: nameOf(staffId) } : a.staff }
          : a,
      ),
    );
    reschedule.mutate(
      { id: ev.id, data: { startAt, ...(staffId ? { staffId } : {}), force } },
      {
        onSuccess: () => saved(`Cita movida a las ${formatTime(startAt, tz, locale)}; se avisa al cliente`),
        onError: (e: unknown) => {
          qc.setQueryData(key, prev);
          if (isApiError(e, 'SLOT_TAKEN') && !force)
            setDialog({ type: 'force', id: ev.id, startAt, staffId, label: `${ev.title} · ${formatTime(startAt, tz, locale)}` });
          else toast.error(errorMessage(e, i18n.t));
        },
        onSettled: () => refresh(),
      },
    );
  };

  const onDrop = ({ event, start, resourceId }: EventInteractionArgs<Ev>) => {
    if (event.kind !== 'appt') return;
    const s = new Date(start);
    const newStaff = useResources && typeof resourceId === 'string' && resourceId !== event.resourceId ? resourceId : undefined;
    if (s.getTime() === event.start.getTime() && !newStaff) return;
    if (newStaff && !access.canManage(newStaff)) return void toast.error('No puedes mover citas a ese barbero');
    move(event, s, newStaff);
  };

  const onSlot = (slot: SlotInfo) => {
    if (!access.canCreate) return;
    const staffId = typeof slot.resourceId === 'string' ? slot.resourceId : (filterStaff ?? (shown.length === 1 ? shown[0]!.id : null));
    const end = slot.action === 'select' ? slot.end : undefined;
    setDialog({ type: 'slot', tab: 'appt', start: slot.start, end, staffId });
  };

  const label = view === 'week'
    ? `${format(rangeStart, 'd MMM', { locale: lang === 'en' ? enUS : es })} – ${format(addDays(rangeEnd, -1), 'd MMM yyyy', { locale: lang === 'en' ? enUS : es })}`
    : format(date, lang === 'en' ? 'EEEE, MMMM d' : "EEEE d 'de' MMMM", { locale: lang === 'en' ? enUS : es });
  const step = (n: number) => set({ d: wallDate(addDays(date, n * (view === 'week' ? 7 : 1))) });
  const isToday = wallDate(date) === wallDate(todayWall);
  const openAppt = dialog?.type === 'appt' ? appts.data?.find((a) => a.id === dialog.id) : undefined;

  const switcher = (tab: 'appt' | 'block') =>
    dialog?.type === 'slot' && access.canBlock(dialog.staffId ?? shown[0]?.id ?? '') ? (
      <div role="tablist" aria-label="Qué crear" className="inline-flex justify-self-start rounded-lg border p-0.5 text-sm">
        {(['appt', 'block'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={cn('rounded-md px-3 py-1', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            onClick={() => setDialog({ ...dialog, tab: k })}>
            {k === 'appt' ? 'Cita' : 'Bloqueo'}
          </button>
        ))}
      </div>
    ) : undefined;

  return (
    <div className="grid gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label={view === 'week' ? 'Semana anterior' : 'Día anterior'} onClick={() => step(-1)}><ChevronLeft aria-hidden /></Button>
          <Button variant="outline" disabled={isToday && view === 'day'} onClick={() => set({ d: null })}>Hoy</Button>
          <Button variant="outline" size="icon" aria-label={view === 'week' ? 'Semana siguiente' : 'Día siguiente'} onClick={() => step(1)}><ChevronRight aria-hidden /></Button>
        </div>
        <h1 className="min-w-0 text-lg font-semibold first-letter:uppercase sm:text-xl" aria-live="polite">{label}</h1>
        {(appts.isFetching || reschedule.isPending) && <Spinner className="size-4" label="Actualizando" />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Vista" className="inline-flex rounded-lg border p-0.5 text-sm">
            {(['day', 'week'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v}
                className={cn('rounded-md px-3 py-1.5', view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                onClick={() => set({ v: v === 'day' ? null : 'week' })}>
                {v === 'day' ? 'Día' : 'Semana'}
              </button>
            ))}
          </div>
          {access.viewAll && visibleStaff.length > 1 && (
            <Select aria-label="Barbero" className="h-9 w-auto" value={filterStaff ?? 'all'} onChange={(e) => set({ b: e.target.value })}>
              <option value="all">Todos los barberos</option>
              {visibleStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          )}
          {access.canCreate && (
            <>
              <Button variant="outline" onClick={() => setDialog({ type: 'slot', tab: 'block', staffId: filterStaff ?? access.ownStaffId, start: parseWall(wallDate(date), '13:00'), end: parseWall(wallDate(date), '14:00') })}>
                <Lock aria-hidden /> Bloquear
              </Button>
              <Button variant="outline" onClick={() => setDialog({ type: 'walkin' })}><Footprints aria-hidden /> Walk-in</Button>
              <Button variant="brand" onClick={() => setDialog({ type: 'slot', tab: 'appt', staffId: filterStaff, start: isToday ? nextQuarter(todayWall) : parseWall(wallDate(date), '10:00') })}>
                <Plus aria-hidden /> Nueva cita
              </Button>
            </>
          )}
        </div>
      </div>

      <Legend showCanceled={showCanceled} onToggleCanceled={() => set({ c: showCanceled ? null : '1' })} />
      {appts.error && <Alert title={errorMessage(appts.error, i18n.t)} />}
      {staffQ.data && visibleStaff.length === 0 && (
        <Alert tone="info" title={access.viewAll ? 'Aún no hay barberos activos.' : 'Tu usuario no está vinculado a un perfil de barbero.'} />
      )}

      <div className={cn('agenda rounded-xl border bg-card', useResources && 'agenda-resources')} style={{ ['--agenda-cols' as string]: shown.length }}>
        <DnDCalendar
          localizer={localizer}
          culture={lang}
          messages={MESSAGES[lang]}
          events={events}
          view={view}
          views={['day', 'week']}
          onView={() => {}}
          date={date}
          onNavigate={(d) => set({ d: wallDate(d) })}
          toolbar={false}
          getNow={() => toWall(new Date(), tz)}
          min={min}
          max={max}
          step={15}
          timeslots={4}
          scrollToTime={min}
          showMultiDayTimes
          allDayAccessor={() => false}
          resources={useResources ? shown.map((s) => ({ id: s.id, title: s.displayName })) : undefined}
          resourceIdAccessor={(r) => r.id}
          resourceTitleAccessor={(r) => r.title}
          selectable={access.canCreate}
          onSelectSlot={onSlot}
          onSelectEvent={(e) => setDialog(e.kind === 'appt' ? { type: 'appt', id: e.id } : { type: 'off', off: e.off })}
          onDrillDown={(d) => set({ v: null, d: wallDate(d) })}
          draggableAccessor={(e) => e.kind === 'appt' && MOVABLE.includes(e.appt.status) && access.canManage(e.resourceId)}
          resizable={false}
          onEventDrop={onDrop}
          eventPropGetter={(e) => {
            const compact = e.end.getTime() - e.start.getTime() < 35 * 60_000;
            return e.kind === 'appt'
              ? { className: cn('agenda-ev', compact && 'agenda-compact', e.appt.status === 'canceled' && 'line-through'), style: toneStyle(STATUS[e.appt.status].tone) }
              : { className: cn('agenda-off', compact && 'agenda-compact') };
          }}
          formats={{
            timeGutterFormat: 'HH:mm',
            eventTimeRangeFormat: ({ start, end }) => `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`,
            dayFormat: (d) => format(d, 'EEE d', { locale: lang === 'en' ? enUS : es }),
            selectRangeFormat: ({ start, end }) => `${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`,
          }}
          components={{ event: (p) => <AgendaEvent {...p} showStaff={view === 'week' && !filterStaff && shown.length > 1} /> }}
          tooltipAccessor={(e) => (e.kind === 'appt' ? `${e.title} · ${e.appt.items.map((i) => i.name).join(' + ')} · ${e.appt.staff.displayName} · ${STATUS[e.appt.status].label}` : `${TIME_OFF_LABEL[e.off.kind]} · ${nameOf(e.resourceId)}${e.off.reason ? ` · ${e.off.reason}` : ''}`)}
        />
      </div>
      {access.canCreate && <p className="text-xs text-muted-foreground">Haz clic en un hueco para crear una cita o bloqueo; arrastra una cita para moverla (se avisa al cliente). También puedes moverla desde su detalle.</p>}

      {dialog?.type === 'appt' && openAppt && <AppointmentDialog appt={openAppt} staff={allStaff} onClose={() => setDialog(null)} />}
      {dialog?.type === 'off' && <TimeOffDialog off={dialog.off} staffName={nameOf(dialog.off.staffId)} onClose={() => setDialog(null)} />}
      {dialog?.type === 'walkin' && <NewAppointmentDialog walkIn staffId={filterStaff ?? (access.manageable(allStaff).length === 1 ? access.ownStaffId : null)} staff={allStaff} onClose={() => setDialog(null)} />}
      {dialog?.type === 'slot' && dialog.tab === 'appt' && (
        <NewAppointmentDialog start={dialog.start} staffId={dialog.staffId} staff={allStaff} onClose={() => setDialog(null)} switcher={switcher('appt')} />
      )}
      {dialog?.type === 'slot' && dialog.tab === 'block' && (
        <BlockDialog start={dialog.start} end={dialog.end} staffId={dialog.staffId} staff={allStaff} onClose={() => setDialog(null)} switcher={switcher('block')} />
      )}
      {dialog?.type === 'force' && (
        <ForceDialog
          label={dialog.label}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const ev = events.find((e) => e.id === dialog.id);
            setDialog(null);
            if (ev?.kind === 'appt') move(ev, toWall(dialog.startAt, tz), dialog.staffId, true);
          }}
        />
      )}
    </div>
  );
}

function AgendaEvent({ event, showStaff }: EventProps<Ev> & { showStaff: boolean }) {
  if (event.kind === 'off') {
    return (
      <span className="flex items-center gap-1 text-xs">
        <Lock className="size-3 shrink-0" aria-hidden /> <span className="truncate">{event.title}</span>
      </span>
    );
  }
  const S = STATUS[event.appt.status];
  if (event.end.getTime() - event.start.getTime() < 35 * 60_000) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-xs font-semibold">
        <S.icon className="size-3 shrink-0" aria-label={S.label} />
        <span className="truncate">{event.title}</span>
      </span>
    );
  }
  return (
    <span className="grid gap-0.5 text-xs leading-tight">
      <span className="flex items-center gap-1 font-semibold">
        <S.icon className="size-3 shrink-0" aria-label={S.label} />
        <span className="truncate">{event.title}</span>
      </span>
      <span className="truncate opacity-80">{event.appt.items.map((i) => i.name).join(' + ')}</span>
      {showStaff && <span className="truncate opacity-80">{event.appt.staff.displayName}</span>}
    </span>
  );
}

function Legend({ showCanceled, onToggleCanceled }: { showCanceled: boolean; onToggleCanceled: () => void }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Estados">
      {(Object.keys(STATUS) as Array<keyof typeof STATUS>).filter((s) => s !== 'canceled').map((s) => {
        const S = STATUS[s];
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-full', S.dot)} aria-hidden />
            <S.icon className="size-3.5" aria-hidden /> {S.label}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5"><span className="agenda-off-swatch size-2.5 rounded-sm border" aria-hidden /><Lock className="size-3.5" aria-hidden /> Bloqueo / ausencia</li>
      <li className="ml-auto">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="size-3.5" checked={showCanceled} onChange={onToggleCanceled} /> Mostrar canceladas
        </label>
      </li>
    </ul>
  );
}

function ForceDialog({ label, onClose, onConfirm }: { label: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Ese horario no está disponible"
      footer={<><Button variant="ghost" onClick={onClose}>Dejarla donde estaba</Button><Button onClick={onConfirm}>Mover igual</Button></>}>
      <p className="text-sm">
        <strong>{label}</strong>: está fuera del horario del barbero o sobre un descanso/bloqueo. Puedes moverla igual; si se
        superpone con otra cita, no se podrá.
      </p>
    </Dialog>
  );
}

/** Rango visible: horario de la sede principal ±1 h, ampliado si hay citas fuera de él. */
function useWorkingRange(appts: Appt[], tz: string) {
  const locations = useLocationsControllerList();
  const primary = locations.data?.find((l) => l.isPrimary) ?? locations.data?.[0];
  const hours = useLocationsControllerGetHours(primary?.id ?? '', { query: { enabled: !!primary } });
  return useMemo(() => {
    const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const blocks = (hours.data?.days ?? []).flatMap((d) => d.blocks);
    let lo = blocks.length ? Math.min(...blocks.map((b) => toMin(b.start))) - 60 : 8 * 60;
    let hi = blocks.length ? Math.max(...blocks.map((b) => toMin(b.end))) + 60 : 21 * 60;
    for (const a of appts) {
      const s = toWall(a.startAt, tz);
      const e = toWall(a.endAt, tz);
      lo = Math.min(lo, s.getHours() * 60);
      hi = Math.max(hi, e.getHours() * 60 + e.getMinutes() + (e.getMinutes() ? 60 - e.getMinutes() : 0));
    }
    lo = Math.max(0, Math.floor(lo / 60) * 60);
    hi = Math.min(24 * 60 - 1, Math.ceil(hi / 60) * 60);
    return { min: new Date(1970, 0, 1, Math.floor(lo / 60), lo % 60), max: new Date(1970, 0, 1, Math.floor(hi / 60), hi % 60) };
  }, [hours.data, appts, tz]);
}

function nextQuarter(wall: Date): Date {
  const d = new Date(wall);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
}

