import { ChevronLeft, ChevronRight, Footprints, HandCoins, Lock, MessageCircle, NotebookPen, Phone, ShoppingCart, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  useCustomersControllerNotes,
  useLocationsControllerGetHours,
  useLocationsControllerList,
  useShopAppointmentsControllerChangeStatus,
  useShopAppointmentsControllerList,
  useShopAppointmentsControllerListTimeOff,
  useStaffControllerList,
} from '@/api/generated/endpoints';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, Skeleton } from '@/components/ui/misc';
import { dayRange, formatDateLong, formatTime, formatTime24, fromWall, localDate, parseWall } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { useNow } from '@/lib/use-now';
import { cn, formatMoney } from '@/lib/utils';
import { addDaysStr } from '../../public/public-utils';
import { useAgendaAccess, useAgendaRefresh, whatsappLink, type Appt } from '../agenda/agenda-utils';
import { AppointmentDialog } from '../agenda/appointment-dialog';
import { BlockDialog } from '../agenda/block-dialog';
import { NewAppointmentDialog } from '../agenda/new-appointment-dialog';
import { STATUS, TIME_OFF_LABEL, toneStyle } from '../agenda/status';
import { duration, openIntervals, timeline } from './my-day-utils';
import { failed, saved } from '../settings/shared-utils';
import { useCan, useShop } from '../shop-context';

const ACTIVE = ['pending', 'confirmed', 'in_progress'];

/**
 * "Mi día": la vista del barbero en el celular. Sus citas en orden, la actual o la siguiente
 * destacada con botones grandes (empezar, completar, no vino) y los huecos libres entre citas.
 */
export function MyDayPage() {
  const shop = useShop();
  if (!shop.staffId) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <EmptyState title="Tu usuario no tiene perfil de barbero" description="Pide al dueño que te vincule a un barbero en Configuración → Usuarios." />
      </div>
    );
  }
  return <MyDay staffId={shop.staffId} />;
}

function MyDay({ staffId }: { staffId: string }) {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const can = useCan();
  const access = useAgendaAccess();
  const now = useNow(30_000);
  const [sp, setSp] = useSearchParams();
  const today = localDate(new Date(now), tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('d') ?? '') ? sp.get('d')! : today;
  const isToday = date === today;
  const range = { ...dayRange(date, tz), staffId };
  const appts = useShopAppointmentsControllerList(range, { query: { refetchInterval: 30_000 } });
  const offs = useShopAppointmentsControllerListTimeOff(range, { query: { refetchInterval: 60_000 } });
  const staff = useStaffControllerList({});
  const me = staff.data?.find((s) => s.id === staffId);
  const openHours = useOpenIntervals(date, tz);
  const [dialog, setDialog] = useState<{ type: 'appt'; id: string } | { type: 'walkin' } | { type: 'block' } | null>(null);

  const list = (appts.data ?? []).filter((a) => a.status !== 'canceled');
  const done = list.filter((a) => a.status === 'completed');
  const pendingCount = list.filter((a) => ACTIVE.includes(a.status)).length;
  const earned = done.reduce((n, a) => n + a.totalCents, 0);
  const expected = list.filter((a) => a.status !== 'no_show').reduce((n, a) => n + a.totalCents, 0);
  // Destacada: la que está en atención; si no, la próxima que aún no terminó.
  const focus =
    list.find((a) => a.status === 'in_progress') ??
    list.find((a) => ['pending', 'confirmed'].includes(a.status) && Date.parse(a.endAt) > now) ??
    null;
  const items = timeline(list, offs.data ?? [], openHours.length ? openHours : undefined);
  const go = (d: string | null) => {
    const next = new URLSearchParams(sp);
    if (d && d !== today) next.set('d', d);
    else next.delete('d');
    setSp(next, { replace: true });
  };
  const open = dialog?.type === 'appt' ? appts.data?.find((a) => a.id === dialog.id) : undefined;

  return (
    <div className="mx-auto grid max-w-lg gap-4 p-4 pb-8">
      <header className="grid gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Día anterior" onClick={() => go(addDaysStr(date, -1))}><ChevronLeft aria-hidden /></Button>
          <div className="grid flex-1 text-center">
            <h1 className="text-lg font-semibold first-letter:uppercase">{isToday ? `Hola${me ? `, ${me.displayName}` : ''}` : formatDateLong(new Date(`${date}T12:00:00Z`), 'UTC', locale)}</h1>
            <p className="text-sm text-muted-foreground first-letter:uppercase">{isToday ? formatDateLong(new Date(now), tz, locale) : <button type="button" className="underline underline-offset-2" onClick={() => go(null)}>Volver a hoy</button>}</p>
          </div>
          <Button variant="outline" size="icon" aria-label="Día siguiente" onClick={() => go(addDaysStr(date, 1))}><ChevronRight aria-hidden /></Button>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border bg-card p-2.5"><dt className="text-xs text-muted-foreground">Citas</dt><dd className="text-xl font-semibold tabular-nums">{appts.data ? list.length : '–'}</dd></div>
          <div className="rounded-xl border bg-card p-2.5"><dt className="text-xs text-muted-foreground">Por atender</dt><dd className="text-xl font-semibold tabular-nums">{appts.data ? pendingCount : '–'}</dd></div>
          <div className="rounded-xl border bg-card p-2.5">
            <dt className="text-xs text-muted-foreground">{isToday ? 'Atendido' : 'Previsto'}</dt>
            <dd className="text-xl font-semibold tabular-nums">{appts.data ? formatMoney(isToday ? earned : expected, shop.barbershop.currency, locale).replace(/\.00$/, '') : '–'}</dd>
          </div>
        </dl>
        {can('commissions.view_own') && (
          <Link to="../mis-comisiones" relative="path" className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-marca-300">
            <span className="flex items-center gap-2"><HandCoins className="size-4 text-marca-700" aria-hidden />Mis comisiones</span>
            <ChevronRight className="size-4 text-slate-400" aria-hidden />
          </Link>
        )}
      </header>

      {access.canCreate && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={() => setDialog({ type: 'walkin' })}><Footprints aria-hidden /> Walk-in</Button>
          <Button variant="outline" size="lg" onClick={() => setDialog({ type: 'block' })}><Lock aria-hidden /> Bloquear</Button>
        </div>
      )}

      {appts.error ? <Alert title="No pudimos cargar tus citas." /> : null}
      {isToday && focus && <FocusCard appt={focus} now={now} canManage={access.canManage(staffId)} canSeeNotes={can('customers.view')} onOpen={() => setDialog({ type: 'appt', id: focus.id })} />}

      <section className="grid gap-2" aria-label="Citas del día">
        {!appts.data ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : items.length === 0 ? (
          <EmptyState title={isToday ? 'No tienes citas hoy' : 'Sin citas este día'} description={access.canCreate ? 'Si llega alguien sin reserva, regístralo como walk-in.' : undefined} />
        ) : (
          <ol className="grid gap-2">
            {items.map((it) =>
              it.kind === 'gap' ? (
                <li key={`gap-${it.start}`} className="px-3 text-xs text-muted-foreground">
                  Libre {formatTime24(new Date(it.start).toISOString(), tz)}–{formatTime24(new Date(it.end).toISOString(), tz)} · {duration(it.end - it.start)}
                </li>
              ) : it.kind === 'off' ? (
                <li key={it.off.id} className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/50 p-3 text-sm text-muted-foreground">
                  <span className="w-12 shrink-0 tabular-nums">{formatTime24(it.off.startsAt, tz)}</span>
                  <Lock className="size-4" aria-hidden />
                  <span>{TIME_OFF_LABEL[it.off.kind]}{it.off.reason ? ` · ${it.off.reason}` : ''} (hasta {formatTime24(it.off.endsAt, tz)})</span>
                </li>
              ) : (
                <li key={it.appt.id}>
                  <Row appt={it.appt} past={isToday && it.end < now} highlight={isToday && focus?.id === it.appt.id} onOpen={() => setDialog({ type: 'appt', id: it.appt.id })} />
                </li>
              ),
            )}
          </ol>
        )}
      </section>

      {open && staff.data && <AppointmentDialog appt={open} staff={staff.data} onClose={() => setDialog(null)} />}
      {dialog?.type === 'walkin' && staff.data && <NewAppointmentDialog walkIn staffId={staffId} staff={staff.data} onClose={() => setDialog(null)} />}
      {dialog?.type === 'block' && staff.data && (
        <BlockDialog staffId={staffId} staff={staff.data} start={nextQuarterWall(now, tz, date)} end={new Date(nextQuarterWall(now, tz, date).getTime() + 60 * 60_000)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** La cita de ahora (o la próxima): datos del cliente, su nota más reciente y los botones grandes. */
function FocusCard({ appt, now, canManage, canSeeNotes, onOpen }: { appt: Appt; now: number; canManage: boolean; canSeeNotes: boolean; onOpen: () => void }) {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const refresh = useAgendaRefresh();
  const canCharge = useCan()('sales.create');
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  const change = useShopAppointmentsControllerChangeStatus({
    mutation: { onSuccess: async (r) => { await refresh(); saved(STATUS[r.status].label); setConfirmNoShow(false); }, onError: failed },
  });
  const notes = useCustomersControllerNotes(appt.customer?.id ?? '', { query: { enabled: canSeeNotes && !!appt.customer } });
  const lastNote = notes.data?.[0];
  const inChair = appt.status === 'in_progress';
  const startsIn = Math.round((Date.parse(appt.startAt) - now) / 60_000);
  const late = !inChair && startsIn < 0;
  const wa = whatsappLink(appt.customer?.phone);
  const S = STATUS[appt.status];
  const act = (status: 'confirmed' | 'in_progress' | 'completed' | 'no_show') => change.mutate({ id: appt.id, data: { status } });

  return (
    <section className={cn('grid gap-3 rounded-2xl border-2 bg-card p-4 shadow-sm', inChair ? 'border-violet-500' : 'border-brand')} aria-label={inChair ? 'En atención' : 'Siguiente cita'}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">
          {inChair ? 'En el sillón' : late ? `Debía empezar hace ${duration(-startsIn * 60_000)}` : startsIn <= 0 ? 'Ahora' : `En ${duration(startsIn * 60_000)}`}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-l-4 px-2 py-0.5 text-xs font-medium" style={toneStyle(S.tone)}><S.icon className="size-3" aria-hidden />{S.label}</span>
      </div>
      <button type="button" className="grid gap-1 text-left" onClick={onOpen}>
        <span className="text-2xl font-semibold">{appt.customer?.fullName ?? 'Walk-in'}</span>
        <span className="text-muted-foreground">{formatTime(appt.startAt, tz, locale)}–{formatTime(appt.endAt, tz, locale)} · {appt.items.map((i) => i.name).join(' + ')}</span>
      </button>
      {appt.customer && appt.customer.noShowCount > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-amber-800"><TriangleAlert className="size-4" aria-hidden />Faltó {appt.customer.noShowCount} vez{appt.customer.noShowCount > 1 ? 'es' : ''} antes</p>
      )}
      {(appt.customerNotes || lastNote || appt.internalNotes) && (
        <div className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm">
          {appt.customerNotes && <p><span className="font-medium">Pidió:</span> {appt.customerNotes}</p>}
          {appt.internalNotes && <p><span className="font-medium">Nota:</span> {appt.internalNotes}</p>}
          {lastNote && (
            <p className="flex gap-2">
              <NotebookPen className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{lastNote.body}</span>
              {lastNote.imageUrl && <img src={lastNote.imageUrl} alt="Foto del último corte" className="ml-auto size-12 shrink-0 rounded-md object-cover" />}
            </p>
          )}
        </div>
      )}
      {appt.customer?.phone && (
        <div className="flex gap-2 text-sm">
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium"><MessageCircle className="size-4" aria-hidden />WhatsApp</a>}
          {!appt.customer.phone.includes('•') && <a href={`tel:${appt.customer.phone}`} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium"><Phone className="size-4" aria-hidden />{formatPhone(appt.customer.phone)}</a>}
        </div>
      )}
      {canManage && (
        <div className="grid grid-cols-2 gap-2">
          {appt.status === 'pending' && <Button size="lg" className="col-span-2 h-14 text-base" loading={change.isPending} onClick={() => act('confirmed')}>Confirmar</Button>}
          {appt.status === 'confirmed' && (
            <>
              <Button size="lg" variant="brand" className="col-span-2 h-14 text-base" loading={change.isPending && change.variables?.data.status === 'in_progress'} onClick={() => act('in_progress')}>Empezar</Button>
              <Button size="lg" variant="outline" className="h-12" loading={change.isPending && change.variables?.data.status === 'completed'} onClick={() => act('completed')}>Ya terminé</Button>
              <Button size="lg" variant="outline" className="h-12" onClick={() => setConfirmNoShow(true)}>No vino</Button>
            </>
          )}
          {inChair && (canCharge ? (
            <Link to={`/s/${shop.barbershop.slug}/caja/cobrar?cita=${appt.id}`} className={buttonVariants({ size: 'lg', variant: 'brand', className: 'col-span-2 h-14 text-base' })}>
              <ShoppingCart aria-hidden /> Cobrar · {formatMoney(appt.totalCents, appt.currency, locale)}
            </Link>
          ) : (
            <Button size="lg" variant="brand" className="col-span-2 h-14 text-base" loading={change.isPending} onClick={() => act('completed')}>Completar · {formatMoney(appt.totalCents, appt.currency, locale)}</Button>
          ))}
        </div>
      )}
      {confirmNoShow && (
        <Dialog open onClose={() => setConfirmNoShow(false)} title="¿No vino?"
          description={`Se marca la inasistencia en la ficha de ${appt.customer?.fullName ?? 'este cliente'}. No se puede deshacer.`}
          footer={<><Button variant="ghost" onClick={() => setConfirmNoShow(false)}>Volver</Button><Button variant="destructive" loading={change.isPending} onClick={() => act('no_show')}>Marcar «No vino»</Button></>} />
      )}
    </section>
  );
}

function Row({ appt, past, highlight, onOpen }: { appt: Appt; past: boolean; highlight: boolean; onOpen: () => void }) {
  const tz = useShop().barbershop.timezone;
  const S = STATUS[appt.status];
  return (
    <button type="button" onClick={onOpen}
      className={cn('flex w-full items-center gap-3 rounded-xl border border-l-4 bg-card p-3 text-left', highlight && 'ring-2 ring-brand', past && !['in_progress'].includes(appt.status) && 'opacity-70')}
      style={{ borderLeftColor: S.tone.line }}>
      <span className="grid w-12 shrink-0 tabular-nums">
        <span className="font-semibold">{formatTime24(appt.startAt, tz)}</span>
        <span className="text-xs text-muted-foreground">{formatTime24(appt.endAt, tz)}</span>
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-medium">{appt.customer?.fullName ?? 'Walk-in'}</span>
        <span className="truncate text-sm text-muted-foreground">{appt.items.map((i) => i.name).join(' + ')}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><S.icon className="size-4" aria-label={S.label} /><span className="hidden min-[400px]:inline">{S.label}</span></span>
    </button>
  );
}

/** Inicio sugerido para un bloqueo: el próximo cuarto de hora (hoy) o las 13:00 (otro día). */
function nextQuarterWall(now: number, tz: string, date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  if (date !== localDate(new Date(now), tz)) return new Date(y!, m! - 1, d!, 13, 0);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const mi = Number(parts.find((p) => p.type === 'minute')?.value);
  const q = Math.ceil((mi + 1) / 15) * 15;
  return new Date(y!, m! - 1, d!, h + Math.floor(q / 60), q % 60);
}

/** Horario de la sede principal para ese día, como intervalos reales (para recortar los huecos). */
function useOpenIntervals(date: string, tz: string): Array<[number, number]> {
  const locations = useLocationsControllerList();
  const primary = locations.data?.find((l) => l.isPrimary) ?? locations.data?.[0];
  const hours = useLocationsControllerGetHours(primary?.id ?? '', { query: { enabled: !!primary } });
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const blocks = hours.data?.days.find((d) => d.dayOfWeek === dow)?.blocks ?? [];
  return openIntervals(blocks, (hhmm) => Date.parse(fromWall(parseWall(date, hhmm), tz)));
}
