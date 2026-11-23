import { CircleCheck, MessageCircle, Move, ShoppingCart, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import {
  useShopAppointmentsControllerChangeStatus,
  useShopAppointmentsControllerReschedule,
  useShopAppointmentsControllerUpdateNotes,
} from '@/api/generated/endpoints';
import type { StaffDtoOutput } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge } from '@/components/ui/misc';
import { formatDateLong, formatTime, fromWall, parseWall, toWall, wallDate, wallTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/utils';
import { useCan, useShop } from '../shop-context';
import { failed, saved } from '../settings/shared-utils';
import { useAgendaAccess, useAgendaRefresh, whatsappLink, type Appt } from './agenda-utils';
import { ACTION_LABEL, NEXT, SOURCE_LABEL, STATUS, toneStyle, DEPOSIT_LABEL } from './status';

/** Detalle de una cita: estado, notas internas y "mover" (alternativa accesible al arrastrar). */
export function AppointmentDialog({ appt, staff, onClose }: { appt: Appt; staff: StaffDtoOutput[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const access = useAgendaAccess();
  const refresh = useAgendaRefresh();
  const manage = access.canManage(appt.staff.id);
  const canCharge = useCan()('sales.create');
  const [notes, setNotes] = useState(appt.internalNotes ?? '');
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState('');
  const [moving, setMoving] = useState(false);

  const status = useShopAppointmentsControllerChangeStatus({
    mutation: {
      onSuccess: async (r) => {
        await refresh();
        saved(STATUS[r.status].label);
        if (r.status === 'canceled') onClose();
      },
      onError: failed,
    },
  });
  const saveNotes = useShopAppointmentsControllerUpdateNotes({
    mutation: { onSuccess: async () => { await refresh(); saved('Nota guardada'); }, onError: failed },
  });

  const S = STATUS[appt.status];
  const wa = whatsappLink(appt.customer?.phone);
  const movable = manage && ['pending', 'confirmed'].includes(appt.status);

  return (
    <Dialog
      open
      onClose={onClose}
      title={appt.customer?.fullName ?? 'Walk-in sin datos'}
      description={
        <span className="first-letter:uppercase">
          {formatDateLong(new Date(appt.startAt), tz, locale)} · {formatTime(appt.startAt, tz, locale)}–{formatTime(appt.endAt, tz, locale)} · {appt.staff.displayName}
        </span>
      }
      footer={<Button variant="ghost" onClick={onClose}>{t('app.close')}</Button>}
    >
      <div className="grid gap-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-l-4 px-2.5 py-0.5 font-medium" style={toneStyle(S.tone)}>
            <S.icon className="size-3.5" aria-hidden /> {S.label}
          </span>
          <Badge>{SOURCE_LABEL[appt.source]}</Badge>
          {appt.deposit && DEPOSIT_LABEL[appt.deposit.status] && (
            <Badge tone={DEPOSIT_LABEL[appt.deposit.status]!.tone}>
              {DEPOSIT_LABEL[appt.deposit.status]!.label} {formatMoney(appt.deposit.amountCents, appt.currency, locale)}
            </Badge>
          )}
          {appt.customer && appt.customer.noShowCount > 0 && (
            <Badge tone="warning"><TriangleAlert className="mr-1 size-3" aria-hidden />{appt.customer.noShowCount} inasistencia(s)</Badge>
          )}
        </div>

        <ul className="divide-y rounded-lg border">
          {appt.items.map((i) => (
            <li key={i.serviceId} className="flex justify-between gap-3 p-2.5">
              <span>{i.name} <span className="text-muted-foreground">· {i.durationMin} min</span></span>
              <span className="tabular-nums">{formatMoney(i.priceCents, appt.currency, locale)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 p-2.5 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(appt.totalCents, appt.currency, locale)}</span>
          </li>
        </ul>

        {appt.customer && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid">
              <span className="text-muted-foreground">Teléfono</span>
              <span className="tabular-nums">{formatPhone(appt.customer.phone) ?? '—'}</span>
            </span>
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium hover:bg-muted">
                <MessageCircle className="size-4" aria-hidden /> WhatsApp
              </a>
            )}
          </div>
        )}

        {appt.customerNotes && (
          <div className="grid gap-1">
            <span className="text-muted-foreground">Nota del cliente</span>
            <p className="rounded-md bg-muted p-2.5 whitespace-pre-wrap">{appt.customerNotes}</p>
          </div>
        )}
        {appt.cancelReason && <Alert tone="info" title={`Motivo de cancelación: ${appt.cancelReason}`} />}

        {manage ? (
          <Field label="Nota interna (no la ve el cliente)">
            {(p) => (
              <div className="grid gap-2">
                <Textarea {...p} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: prefiere degradado bajo" />
                {notes !== (appt.internalNotes ?? '') && (
                  <Button size="sm" variant="outline" className="justify-self-end" loading={saveNotes.isPending}
                    onClick={() => saveNotes.mutate({ id: appt.id, data: { internalNotes: notes.trim() || null } })}>
                    Guardar nota
                  </Button>
                )}
              </div>
            )}
          </Field>
        ) : appt.internalNotes ? (
          <div className="grid gap-1"><span className="text-muted-foreground">Nota interna</span><p className="whitespace-pre-wrap">{appt.internalNotes}</p></div>
        ) : null}

        {canCharge && !['canceled', 'no_show', 'awaiting_payment'].includes(appt.status) && (
          appt.saleId ? (
            <Link to={`/s/${shop.barbershop.slug}/caja/ventas?venta=${appt.saleId}`} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <span className="flex items-center gap-2"><CircleCheck className="size-4" aria-hidden />Cobrada</span><span className="underline underline-offset-2">Ver venta</span>
            </Link>
          ) : (
            <Link to={`/s/${shop.barbershop.slug}/caja/cobrar?cita=${appt.id}`} className={buttonVariants({ size: 'lg', className: 'w-full' })}>
              <ShoppingCart aria-hidden /> Cobrar {formatMoney(appt.totalCents, appt.currency, locale)}
            </Link>
          )
        )}

        {manage && NEXT[appt.status].length > 0 && !canceling && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {NEXT[appt.status].map((next) => {
              const N = STATUS[next];
              return (
                <Button key={next} variant={next === 'canceled' || next === 'no_show' ? 'outline' : 'default'}
                  loading={status.isPending && status.variables?.data.status === next}
                  onClick={() => (next === 'canceled' ? setCanceling(true) : status.mutate({ id: appt.id, data: { status: next } }))}>
                  <N.icon aria-hidden /> {ACTION_LABEL[next]}
                </Button>
              );
            })}
            {movable && (
              <Button variant="ghost" onClick={() => setMoving((v) => !v)} aria-expanded={moving}>
                <Move aria-hidden /> Mover
              </Button>
            )}
          </div>
        )}

        {canceling && (
          <div className="grid gap-3 rounded-lg border p-3">
            <Field label="Motivo (opcional; se guarda en el historial)">
              {(p) => <Input {...p} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="El cliente avisó por WhatsApp" />}
            </Field>
            <p className="text-muted-foreground">Si el cliente tiene WhatsApp, recibirá el aviso de cancelación.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCanceling(false)}>Volver</Button>
              <Button variant="destructive" loading={status.isPending}
                onClick={() => status.mutate({ id: appt.id, data: { status: 'canceled', ...(reason.trim() ? { reason: reason.trim() } : {}) } })}>
                Cancelar la cita
              </Button>
            </div>
          </div>
        )}

        {moving && <MoveForm appt={appt} staff={access.manageable(staff)} onDone={() => { setMoving(false); onClose(); }} />}
      </div>
    </Dialog>
  );
}

function MoveForm({ appt, staff, onDone }: { appt: Appt; staff: StaffDtoOutput[]; onDone: () => void }) {
  const { t } = useTranslation();
  const tz = useShop().barbershop.timezone;
  const refresh = useAgendaRefresh();
  const wall = toWall(appt.startAt, tz);
  const [f, setF] = useState({ date: wallDate(wall), time: wallTime(wall), staffId: appt.staff.id, force: false });
  const move = useShopAppointmentsControllerReschedule({
    mutation: { onSuccess: async () => { await refresh(); saved('Cita movida; se avisa al cliente'); onDone(); } },
  });
  const taken = isApiError(move.error, 'SLOT_TAKEN');
  return (
    <form
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        move.mutate({
          id: appt.id,
          data: {
            startAt: fromWall(parseWall(f.date, f.time), tz),
            ...(f.staffId !== appt.staff.id ? { staffId: f.staffId } : {}),
            force: f.force,
          },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha">{(p) => <Input {...p} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Hora">{(p) => <Input {...p} type="time" required step={300} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
        <Field label="Barbero">
          {(p) => (
            <Select {...p} value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          )}
        </Field>
      </div>
      {move.error && (
        <Alert title={taken ? 'Ese horario no está disponible: está ocupado o fuera del horario del barbero.' : errorMessage(move.error, t)} />
      )}
      <Checkbox label="Permitir fuera del horario (nunca encima de otra cita)" checked={f.force} onChange={(e) => setF({ ...f, force: e.target.checked })} />
      <Button type="submit" className="justify-self-end" loading={move.isPending}>Mover cita</Button>
    </form>
  );
}
