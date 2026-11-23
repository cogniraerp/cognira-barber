import { Search, UserRound, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import {
  useCustomersControllerList,
  useServicesControllerList,
  useShopAppointmentsControllerCreate,
} from '@/api/generated/endpoints';
import type { StaffDtoOutput } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { formatTime, fromWall, parseWall, toWall, wallDate, wallTime } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/use-debounced';
import { formatMoney } from '@/lib/utils';
import { useCan, useShop } from '../shop-context';
import { saved } from '../settings/shared-utils';
import { useAgendaAccess, useAgendaRefresh } from './agenda-utils';

export type Picked = { id: string; fullName: string; phone: string | null };

/**
 * Cita desde el panel. `walkIn`: el cliente ya está en el local → empieza ahora (sin hora) y,
 * por defecto, queda "en atención".
 */
export function NewAppointmentDialog({
  walkIn = false,
  start,
  staffId: initialStaff,
  staff,
  onClose,
  switcher,
  customer: initialCustomer,
}: {
  walkIn?: boolean;
  start?: Date;
  staffId?: string | null;
  staff: StaffDtoOutput[];
  onClose: () => void;
  switcher?: ReactNode;
  /** Cliente ya elegido (p. ej. desde su ficha). */
  customer?: Picked;
}) {
  const { t, i18n } = useTranslation();
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const access = useAgendaAccess();
  const refresh = useAgendaRefresh();
  const mine = access.manageable(staff);
  const anyAllowed = mine.length > 1;
  const services = useServicesControllerList({});

  const [f, setF] = useState({
    staffId: initialStaff ?? (anyAllowed ? '' : (mine[0]?.id ?? '')),
    serviceIds: [] as string[],
    date: start ? wallDate(start) : '',
    time: start ? wallTime(start) : '',
    source: 'phone' as 'phone' | 'staff',
    inChair: true,
    notes: '',
    force: false,
  });
  const [customer, setCustomer] = useState<{ picked: Picked | null; name: string; phone: string }>({ picked: initialCustomer ?? null, name: '', phone: '' });

  const create = useShopAppointmentsControllerCreate({
    mutation: { onSuccess: async () => { await refresh(); saved(walkIn ? 'Walk-in registrado' : 'Cita creada'); onClose(); } },
  });
  const err: unknown = create.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};
  const alternatives = isApiError(err, 'SLOT_TAKEN') ? ((err.problem.alternatives as string[] | undefined) ?? []) : [];

  const active = (services.data ?? []).filter((s) => s.isActive && (!f.staffId || s.staff.some((x) => x.staffId === f.staffId)));
  const priceOf = (id: string) => {
    const s = services.data?.find((x) => x.id === id);
    const own = s?.staff.find((x) => x.staffId === f.staffId);
    return { price: own?.priceCents ?? s?.priceCents ?? 0, min: own?.durationMin ?? s?.durationMin ?? 0 };
  };
  const total = f.serviceIds.reduce((n, id) => n + priceOf(id).price, 0);
  const minutes = f.serviceIds.reduce((n, id) => n + priceOf(id).min, 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = customer.picked
      ? { id: customer.picked.id }
      : customer.name.trim().length >= 2
        ? { fullName: customer.name.trim(), phone: customer.phone.trim() || null }
        : null;
    create.mutate({
      data: {
        serviceIds: f.serviceIds,
        staffId: f.staffId || null,
        customer: c,
        internalNotes: f.notes.trim() || null,
        ...(walkIn
          ? { source: 'walk_in', status: f.inChair ? 'in_progress' : 'confirmed' }
          : { source: f.source, startAt: fromWall(parseWall(f.date, f.time), tz), force: f.force }),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={walkIn ? 'Walk-in' : 'Nueva cita'}
      description={walkIn ? 'El cliente ya está en el local: la cita empieza ahora.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button>
          <Button type="submit" form="new-appt" variant="brand" loading={create.isPending} disabled={!f.serviceIds.length}>
            {walkIn ? 'Registrar walk-in' : 'Crear cita'}
          </Button>
        </>
      }
    >
      <form id="new-appt" onSubmit={submit} className="grid gap-4">
        {switcher}
        {create.error && !alternatives.length && !Object.keys(fe).length ? <Alert title={errorMessage(create.error, t)} /> : null}
        {isApiError(err, 'SLOT_TAKEN') && (
          <Alert title="Ese horario no está disponible.">
            {alternatives.length ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span>Libres ese día:</span>
                {alternatives.map((a) => (
                  <Button key={a} type="button" size="sm" variant="outline"
                    onClick={() => setF({ ...f, date: wallDate(toWall(a, tz)), time: wallTime(toWall(a, tz)) })}>
                    {formatTime(a, tz, locale)}
                  </Button>
                ))}
              </div>
            ) : (
              'Está ocupado o fuera del horario. Marca "Permitir fuera del horario" si quieres agendarla igual.'
            )}
          </Alert>
        )}

        <Field label="Barbero">
          {(p) => (
            <Select {...p} value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value, serviceIds: [] })}>
              {anyAllowed && <option value="">Cualquiera disponible</option>}
              {mine.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          )}
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Servicios</legend>
          {!services.data ? <Skeleton className="h-24" /> : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este barbero no tiene servicios asignados.</p>
          ) : (
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2">
              {active.map((s) => {
                const on = f.serviceIds.includes(s.id);
                const q = priceOf(s.id);
                return (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted">
                    <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={on} disabled={!on && f.serviceIds.length >= 5}
                      onChange={() => setF({ ...f, serviceIds: on ? f.serviceIds.filter((x) => x !== s.id) : [...f.serviceIds, s.id] })} />
                    <span className="flex-1">{s.name}</span>
                    <span className="text-muted-foreground tabular-nums">{f.staffId ? `${q.min} min · ${formatMoney(q.price, shop.barbershop.currency, locale)}` : `${s.durationMin} min`}</span>
                  </label>
                );
              })}
            </div>
          )}
          {f.serviceIds.length > 0 && f.staffId && (
            <p className="text-sm text-muted-foreground">Total: <span className="font-medium text-foreground tabular-nums">{minutes} min · {formatMoney(total, shop.barbershop.currency, locale)}</span></p>
          )}
        </fieldset>

        {!walkIn && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Fecha" error={fe.startAt}>{(p) => <Input {...p} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
            <Field label="Hora">{(p) => <Input {...p} type="time" required step={300} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
            <Field label="Canal">
              {(p) => (
                <Select {...p} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as 'phone' })}>
                  <option value="phone">Teléfono / WhatsApp</option>
                  <option value="staff">En el local</option>
                </Select>
              )}
            </Field>
          </div>
        )}

        <CustomerPicker value={customer} onChange={setCustomer} optional={walkIn} />

        <Field label="Nota interna (opcional)">
          {(p) => <Textarea {...p} className="min-h-14" maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}
        </Field>

        {walkIn ? (
          <Checkbox label="Ya se está atendiendo (queda «En atención»)" checked={f.inChair} onChange={(e) => setF({ ...f, inChair: e.target.checked })} />
        ) : (
          <Checkbox label="Permitir fuera del horario (nunca encima de otra cita)" checked={f.force} onChange={(e) => setF({ ...f, force: e.target.checked })} />
        )}
      </form>
    </Dialog>
  );
}

/** Busca un cliente existente por nombre o teléfono; si no aparece, se crea con lo escrito. */
function CustomerPicker({
  value,
  onChange,
  optional,
}: {
  value: { picked: Picked | null; name: string; phone: string };
  onChange: (v: { picked: Picked | null; name: string; phone: string }) => void;
  optional: boolean;
}) {
  const can = useCan();
  const searchable = can('customers.view');
  const q = useDebounced(value.name.trim(), 250);
  const found = useCustomersControllerList({ q, pageSize: 5 }, { query: { enabled: searchable && !value.picked && q.length >= 2 } });
  const [hideResults, setHideResults] = useState(false);

  if (value.picked) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Cliente</span>
        <div className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
          <UserRound className="size-4 text-muted-foreground" aria-hidden />
          <span className="grid flex-1">
            <span className="font-medium">{value.picked.fullName}</span>
            <span className="text-muted-foreground tabular-nums">{formatPhone(value.picked.phone) ?? 'Sin teléfono'}</span>
          </span>
          <Button type="button" variant="ghost" size="icon" aria-label="Quitar cliente" onClick={() => onChange({ picked: null, name: '', phone: '' })}><X aria-hidden /></Button>
        </div>
      </div>
    );
  }
  const items = found.data?.items ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="relative">
        <Field label={optional ? 'Cliente (opcional)' : 'Cliente'}>
          {(p) => (
            <div className="relative">
              {searchable && <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />}
              <Input {...p} className={searchable ? 'pl-9' : undefined} autoComplete="off" value={value.name} maxLength={120}
                placeholder={searchable ? 'Buscar o escribir nombre' : 'Nombre'}
                onChange={(e) => { setHideResults(false); onChange({ ...value, name: e.target.value }); }} />
            </div>
          )}
        </Field>
        {searchable && !hideResults && q.length >= 2 && items.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-card shadow-lg" aria-label="Clientes encontrados">
            {items.map((c) => (
              <li key={c.id}>
                <button type="button" className="grid w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50" disabled={c.isBlocked}
                  onClick={() => onChange({ picked: { id: c.id, fullName: c.fullName, phone: c.phone }, name: '', phone: '' })}>
                  <span className="font-medium">{c.fullName}{c.isBlocked ? ' · bloqueado' : ''}</span>
                  <span className="text-muted-foreground tabular-nums">{formatPhone(c.phone) ?? 'Sin teléfono'}{c.noShowCount ? ` · ${c.noShowCount} inasistencia(s)` : ''}</span>
                </button>
              </li>
            ))}
            <li><button type="button" className="w-full border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted" onClick={() => setHideResults(true)}>Es un cliente nuevo</button></li>
          </ul>
        )}
      </div>
      <Field label="Teléfono">
        {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="off" value={value.phone} maxLength={25} placeholder="987 654 321" onChange={(e) => onChange({ ...value, phone: e.target.value })} />}
      </Field>
    </div>
  );
}
