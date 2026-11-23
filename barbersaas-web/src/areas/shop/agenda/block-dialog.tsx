import { Trash2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { useStaffControllerAddTimeOff, useStaffControllerRemoveTimeOff } from '@/api/generated/endpoints';
import type { AgendaTimeOffListDtoItem, StaffDtoOutput } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { formatDateLong, formatTime, fromWall, localDate, parseWall, wallDate, wallTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import { useShop } from '../shop-context';
import { failed, saved } from '../settings/shared-utils';
import { useAgendaAccess, useAgendaRefresh } from './agenda-utils';
import { TIME_OFF_LABEL } from './status';

/** Bloquear un rango del día de un barbero (almuerzo, trámite…): deja de ofrecerse online. */
export function BlockDialog({
  start,
  end,
  staffId,
  staff,
  onClose,
  switcher,
}: {
  start?: Date;
  end?: Date;
  staffId?: string | null;
  staff: StaffDtoOutput[];
  onClose: () => void;
  switcher?: ReactNode;
}) {
  const { t } = useTranslation();
  const tz = useShop().barbershop.timezone;
  const access = useAgendaAccess();
  const refresh = useAgendaRefresh();
  const allowed = staff.filter((s) => access.canBlock(s.id));
  const [f, setF] = useState({
    staffId: staffId && allowed.some((s) => s.id === staffId) ? staffId : (allowed[0]?.id ?? ''),
    date: start ? wallDate(start) : '',
    from: start ? wallTime(start) : '13:00',
    to: end ? wallTime(end) : '14:00',
    reason: '',
  });
  const add = useStaffControllerAddTimeOff({
    mutation: { onSuccess: async () => { await refresh(); saved('Horario bloqueado'); onClose(); } },
  });
  const err: unknown = add.error;
  const conflicts = isApiError(err, 'CONFLICT') ? ((err.problem.conflicts as unknown[] | undefined) ?? []).length : 0;
  const fe = isApiError(err) ? err.fieldErrors() : {};

  const send = (ignoreConflicts: boolean) =>
    add.mutate({
      id: f.staffId,
      data: {
        startsAt: fromWall(parseWall(f.date, f.from), tz),
        endsAt: fromWall(parseWall(f.date, f.to), tz),
        kind: 'block',
        reason: f.reason.trim() || null,
        ignoreConflicts,
      },
    });
  const submit = (e: FormEvent) => { e.preventDefault(); send(false); };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Bloquear horario"
      description="Ese rango deja de ofrecerse para reservas. Las vacaciones se registran en Barberos."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button>
          {conflicts > 0 ? (
            <Button variant="destructive" loading={add.isPending} onClick={() => send(true)}>Bloquear igual</Button>
          ) : (
            <Button type="submit" form="block-form" loading={add.isPending} disabled={!f.staffId}>Bloquear</Button>
          )}
        </>
      }
    >
      <form id="block-form" onSubmit={submit} className="grid gap-4">
        {switcher}
        {conflicts > 0 ? (
          <Alert title={`Hay ${conflicts} cita(s) en ese rango.`}>Si bloqueas igual, las citas se mantienen: muévelas o cancélalas desde la agenda.</Alert>
        ) : add.error && !Object.keys(fe).length ? <Alert title={errorMessage(add.error, t)} /> : null}
        <Field label="Barbero">
          {(p) => (
            <Select {...p} value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
              {allowed.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fecha">{(p) => <Input {...p} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Desde">{(p) => <Input {...p} type="time" required step={300} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label="Hasta" error={fe.endsAt}>{(p) => <Input {...p} type="time" required step={300} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        </div>
        <Field label="Motivo (opcional)">
          {(p) => <Input {...p} value={f.reason} maxLength={200} placeholder="Almuerzo" onChange={(e) => setF({ ...f, reason: e.target.value })} />}
        </Field>
      </form>
    </Dialog>
  );
}

export function TimeOffDialog({ off, staffName, onClose }: { off: AgendaTimeOffListDtoItem; staffName: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const tz = useShop().barbershop.timezone;
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const access = useAgendaAccess();
  const refresh = useAgendaRefresh();
  const remove = useStaffControllerRemoveTimeOff({
    mutation: { onSuccess: async () => { await refresh(); saved('Bloqueo eliminado'); onClose(); }, onError: failed },
  });
  const sameDay = localDate(new Date(off.startsAt), tz) === localDate(new Date(off.endsAt), tz);
  const when = sameDay
    ? `${formatDateLong(new Date(off.startsAt), tz, locale)} · ${formatTime(off.startsAt, tz, locale)}–${formatTime(off.endsAt, tz, locale)}`
    : `${formatDateLong(new Date(off.startsAt), tz, locale)} → ${formatDateLong(new Date(off.endsAt), tz, locale)}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${TIME_OFF_LABEL[off.kind]} · ${staffName}`}
      description={<span className="first-letter:uppercase">{when}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('app.close')}</Button>
          {access.canRemoveTimeOff(off.staffId, off.kind) && (
            <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: off.staffId, timeOffId: off.id })}>
              <Trash2 aria-hidden /> Quitar {TIME_OFF_LABEL[off.kind].toLowerCase()}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm">{off.reason ?? 'Sin motivo.'}</p>
    </Dialog>
  );
}
