import { ArrowLeft, CalendarPlus, Check, CircleCheck, Clock, Hourglass, Scissors, UserRound, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { isApiError } from '@/api/errors';
import { useQueryClient } from '@tanstack/react-query';
import { getPublicBookingControllerViewQueryKey, usePublicBookingControllerBook } from '@/api/generated/endpoints';
import type { AvailabilityDto, PublicAppointmentDto, PublicShopDtoOutput } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { formatDateLong, formatTime } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
import { eligibleStaff, money, priceRange, rememberBooking, rememberContact, savedContact } from './public-utils';
import { SlotPicker, type Slot } from './slot-picker';

export type Step = 'servicios' | 'barbero' | 'horario' | 'datos' | 'listo';
export type Selection = {
  serviceIds: string[];
  /** null = cualquiera disponible */
  staffId: string | null;
  slot: Slot | null;
  quotes: AvailabilityDto['staff'];
};

/**
 * Asistente de reserva: servicios → barbero → día y hora → datos → listo.
 * El paso va en la URL (?reservar=horario) para que "atrás" del navegador retroceda un paso.
 */
export function BookingWizard({
  shop,
  step,
  go,
  sel,
  setSel,
  manageHref,
  onClose,
}: {
  shop: PublicShopDtoOutput;
  step: Step;
  go: (s: Step, replace?: boolean) => void;
  sel: Selection;
  setSel: (s: Selection) => void;
  manageHref: (token: string) => string;
  onClose: () => void;
}) {
  const [done, setDone] = useState<PublicAppointmentDto | null>(null);
  const pickStaff = shop.booking.allowStaffSelection;
  const steps: Step[] = pickStaff ? ['servicios', 'barbero', 'horario', 'datos'] : ['servicios', 'horario', 'datos'];
  const index = steps.indexOf(step);
  const back = () => (index > 0 ? go(steps[index - 1]!) : onClose());
  const next = () => go(steps[index + 1]!);

  // Llegar a un paso sin lo necesario (p. ej. recargar la página) → volver al primero que falte.
  const missing: Step | null =
    step !== 'servicios' && !sel.serviceIds.length ? 'servicios'
      : (step === 'datos' && !sel.slot) ? 'horario'
        : step === 'listo' && !done ? 'servicios'
          : null;
  const redirect = missing && missing !== step ? missing : null;
  useEffect(() => {
    if (redirect) go(redirect, true);
  }, [redirect, go]);
  if (redirect) return null;

  // Con adelanto, el pago y su seguimiento viven en la página de la cita.
  if (step === 'listo' && done?.status === 'awaiting_payment') return <Navigate to={manageHref(done.manageToken)} replace />;
  if (step === 'listo' && done) return <Done shop={shop} appt={done} manageHref={manageHref} onClose={onClose} />;

  return (
    <div className="mx-auto grid min-h-dvh max-w-2xl content-start gap-5 px-4 pt-4 pb-40 sm:px-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={back} aria-label={index > 0 ? 'Paso anterior' : 'Cerrar'}>
          {index > 0 ? <ArrowLeft aria-hidden /> : <X aria-hidden />}
        </Button>
        <div className="grid flex-1 gap-1.5">
          <p className="text-sm text-muted-foreground">Paso {index + 1} de {steps.length}</p>
          <div className="flex gap-1" aria-hidden>
            {steps.map((s, i) => <span key={s} className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-brand' : 'bg-muted')} />)}
          </div>
        </div>
      </div>

      {step === 'servicios' && <Services shop={shop} sel={sel} setSel={setSel} />}
      {step === 'barbero' && <Staff shop={shop} sel={sel} setSel={(s) => { setSel(s); next(); }} />}
      {step === 'horario' && (
        <section className="grid gap-4">
          <h1 className="text-2xl font-semibold">Elige día y hora</h1>
          <SlotPicker
            slug={shop.slug}
            serviceIds={sel.serviceIds}
            staffId={sel.staffId}
            tz={shop.timezone}
            maxAdvanceDays={shop.booking.maxAdvanceDays}
            value={sel.slot}
            onChange={(slot, quotes) => setSel({ ...sel, slot, quotes })}
          />
        </section>
      )}
      {step === 'datos' && <Details shop={shop} sel={sel} setSel={setSel} onBooked={(a) => { setDone(a); go('listo', true); }} onChangeTime={() => go('horario')} />}

      {step !== 'datos' && step !== 'barbero' && (
        <Summary shop={shop} sel={sel}
          action={
            <Button variant="brand" size="lg" className="w-full sm:w-auto"
              disabled={step === 'servicios' ? !sel.serviceIds.length : !sel.slot}
              onClick={next}>
              Continuar
            </Button>
          }
        />
      )}
    </div>
  );
}

function Services({ shop, sel, setSel }: { shop: PublicShopDtoOutput; sel: Selection; setSel: (s: Selection) => void }) {
  const groups = [
    ...shop.categories.map((c) => ({ id: c.id, name: c.name, items: shop.services.filter((s) => s.categoryId === c.id) })),
    { id: 'none', name: shop.categories.length ? 'Otros' : '', items: shop.services.filter((s) => !s.categoryId || !shop.categories.some((c) => c.id === s.categoryId)) },
  ].filter((g) => g.items.length);
  const toggle = (id: string) => {
    const on = sel.serviceIds.includes(id);
    const serviceIds = on ? sel.serviceIds.filter((x) => x !== id) : [...sel.serviceIds, id].slice(0, 5);
    // Cambiar servicios invalida el barbero (puede no hacerlos) y la hora (cambia la duración).
    const staffOk = !sel.staffId || eligibleStaff(shop, serviceIds).some((s) => s.id === sel.staffId);
    setSel({ ...sel, serviceIds, staffId: staffOk ? sel.staffId : null, slot: null });
  };
  return (
    <section className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold">¿Qué te hacemos?</h1>
        <p className="text-sm text-muted-foreground">Puedes elegir más de un servicio.</p>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="grid gap-2">
          {g.name && <h2 className="text-sm font-medium text-muted-foreground">{g.name}</h2>}
          {g.items.map((s) => {
            const on = sel.serviceIds.includes(s.id);
            return (
              <button key={s.id} type="button" aria-pressed={on} onClick={() => toggle(s.id)}
                className={cn('flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors', on ? 'border-brand ring-1 ring-brand' : 'hover:border-foreground/40')}>
                {s.imageUrl && <img src={s.imageUrl} alt="" className="size-14 shrink-0 rounded-lg object-cover" />}
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">{s.name}</span>
                  {s.description && <span className="line-clamp-2 text-sm text-muted-foreground">{s.description}</span>}
                  <span className="flex items-center gap-1 text-sm text-muted-foreground"><Clock className="size-3.5" aria-hidden /> {s.durationMin} min</span>
                </span>
                <span className="grid justify-items-end gap-1.5">
                  <span className="font-semibold tabular-nums">{money(shop, s.priceFromCents, s.priceToCents)}</span>
                  <span className={cn('grid size-6 place-items-center rounded-full border', on ? 'border-brand bg-brand text-brand-foreground' : '')} aria-hidden>
                    {on && <Check className="size-4" />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function Staff({ shop, sel, setSel }: { shop: PublicShopDtoOutput; sel: Selection; setSel: (s: Selection) => void }) {
  const list = eligibleStaff(shop, sel.serviceIds);
  const choose = (staffId: string | null) => setSel({ ...sel, staffId, slot: sel.staffId === staffId ? sel.slot : null });
  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold">¿Con quién?</h1>
        <p className="text-sm text-muted-foreground">Barberos que hacen {sel.serviceIds.length > 1 ? 'todos los servicios elegidos' : 'este servicio'}.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {shop.booking.allowAnyStaff && list.length > 1 && (
          <button type="button" onClick={() => choose(null)}
            className={cn('flex items-center gap-3 rounded-xl border bg-card p-3 text-left', sel.staffId === null ? 'border-brand ring-1 ring-brand' : 'hover:border-foreground/40')}>
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-muted"><Users className="size-6 text-muted-foreground" aria-hidden /></span>
            <span className="grid">
              <span className="font-medium">Cualquiera disponible</span>
              <span className="text-sm text-muted-foreground">Más horarios para elegir</span>
            </span>
          </button>
        )}
        {list.map((st) => (
          <button key={st.id} type="button" onClick={() => choose(st.id)}
            className={cn('flex items-center gap-3 rounded-xl border bg-card p-3 text-left', sel.staffId === st.id ? 'border-brand ring-1 ring-brand' : 'hover:border-foreground/40')}>
            <Avatar name={st.displayName} url={st.photoUrl} />
            <span className="grid min-w-0">
              <span className="font-medium">{st.displayName}</span>
              {st.specialties.length > 0 && <span className="truncate text-sm text-muted-foreground">{st.specialties.join(' · ')}</span>}
            </span>
          </button>
        ))}
      </div>
      {list.length === 0 && <Alert title="Ningún barbero hace todos esos servicios juntos. Prueba quitando alguno." />}
    </section>
  );
}

function Details({
  shop,
  sel,
  setSel,
  onBooked,
  onChangeTime,
}: {
  shop: PublicShopDtoOutput;
  sel: Selection;
  setSel: (s: Selection) => void;
  onBooked: (a: PublicAppointmentDto) => void;
  onChangeTime: () => void;
}) {
  const rf = shop.booking.requiredFields;
  const prev = savedContact();
  const [f, setF] = useState({ fullName: prev?.fullName ?? '', phone: prev?.phone ?? '', email: prev?.email ?? '', notes: '', website: '', remember: true });
  const [custom, setCustom] = useState<Record<string, string | boolean>>({});
  const book = usePublicBookingControllerBook();
  const qc = useQueryClient();
  const err: unknown = book.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};
  const alternatives = isApiError(err, 'SLOT_TAKEN') ? ((err.problem.alternatives as string[] | undefined) ?? []) : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!sel.slot) return;
    const staffId = sel.staffId;
    book.mutate(
      {
        slug: shop.slug,
        data: {
          serviceIds: sel.serviceIds,
          staffId,
          startAt: sel.slot.start,
          customer: {
            fullName: f.fullName.trim(),
            ...(rf.phone !== 'hidden' && f.phone.trim() ? { phone: f.phone.trim() } : {}),
            ...(rf.email !== 'hidden' && f.email.trim() ? { email: f.email.trim() } : {}),
          },
          ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
          customFields: custom,
          ...(f.website ? { website: f.website } : {}),
        },
      },
      {
        onSuccess: (a) => {
          rememberBooking(shop.slug, { token: a.manageToken, startAt: a.startAt });
          qc.setQueryData(getPublicBookingControllerViewQueryKey(a.manageToken), a);
          rememberContact(f.remember ? { fullName: f.fullName.trim(), phone: f.phone.trim(), email: f.email.trim() } : null);
          onBooked(a);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <h1 className="text-2xl font-semibold">Tus datos</h1>
      <Summary shop={shop} sel={sel} inline onChangeTime={onChangeTime} />

      {isApiError(err, 'SLOT_TAKEN') ? (
        <Alert title="Alguien acaba de tomar ese horario.">
          {alternatives.length ? (
            <div className="mt-2 grid gap-2">
              <span>Estos siguen libres ese día:</span>
              <div className="flex flex-wrap gap-2">
                {alternatives.map((a) => (
                  <Button key={a} type="button" size="sm" variant="outline" onClick={() => { setSel({ ...sel, slot: { start: a } }); book.reset(); }}>
                    {formatTime(a, shop.timezone, 'es-PE')}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Button type="button" variant="link" className="h-auto px-0" onClick={onChangeTime}>Elegir otro horario</Button>
          )}
        </Alert>
      ) : book.error && !Object.keys(fe).length ? (
        <Alert title={errorMessage(book.error, i18n.t)} />
      ) : null}

      <Field label="Nombre y apellido" error={fe['customer.fullName']}>
        {(p) => <Input {...p} required minLength={2} maxLength={120} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}
      </Field>
      {rf.phone !== 'hidden' && (
        <Field label={rf.phone === 'required' ? 'Celular (WhatsApp)' : 'Celular (opcional)'} error={fe['customer.phone']} hint="Te enviamos la confirmación y un recordatorio.">
          {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="tel" required={rf.phone === 'required'} maxLength={25} placeholder="987 654 321" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
        </Field>
      )}
      {rf.email !== 'hidden' && (
        <Field label={rf.email === 'required' ? 'Email' : 'Email (opcional)'} error={fe['customer.email']}>
          {(p) => <Input {...p} type="email" autoComplete="email" required={rf.email === 'required'} maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        </Field>
      )}
      {shop.booking.customFields.map((cf) => {
        const v = custom[cf.key];
        const set = (val: string | boolean) => setCustom({ ...custom, [cf.key]: val });
        if (cf.type === 'checkbox') return <Checkbox key={cf.key} label={cf.label} required={cf.required} checked={v === true} onChange={(e) => set(e.target.checked)} />;
        return (
          <Field key={cf.key} label={cf.required ? cf.label : `${cf.label} (opcional)`} error={fe[`customFields.${cf.key}`]}>
            {(p) => cf.type === 'select' ? (
              <Select {...p} required={cf.required} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)}>
                <option value="">Elige una opción</option>
                {cf.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : cf.type === 'textarea' ? (
              <Textarea {...p} required={cf.required} maxLength={500} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)} />
            ) : (
              <Input {...p} required={cf.required} maxLength={500} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)} />
            )}
          </Field>
        );
      })}
      <Field label="Comentario para el barbero (opcional)">
        {(p) => <Textarea {...p} className="min-h-16" maxLength={500} value={f.notes} placeholder="Ej.: quiero el mismo corte de la última vez" onChange={(e) => setF({ ...f, notes: e.target.value })} />}
      </Field>
      {/* Honeypot: invisible para personas; los bots lo completan y la API rechaza la reserva. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>Sitio web<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" /></label>
      </div>
      <Checkbox label="Recordar mis datos en este dispositivo" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto grid max-w-2xl gap-2 sm:flex sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {shop.booking.approvalMode === 'manual' ? 'La barbería confirmará tu reserva.' : 'Tu cita queda confirmada al instante.'}
            {shop.booking.cancellationWindowHours > 0 && ` Puedes cancelar hasta ${shop.booking.cancellationWindowHours} h antes.`}
          </p>
          <Button type="submit" variant="brand" size="lg" loading={book.isPending} className="w-full sm:w-auto">Confirmar reserva</Button>
        </div>
      </div>
    </form>
  );
}

/** Resumen de lo elegido: barra fija abajo en los primeros pasos, tarjeta en "Tus datos". */
function Summary({ shop, sel, action, inline, onChangeTime }: { shop: PublicShopDtoOutput; sel: Selection; action?: ReactNode; inline?: boolean; onChangeTime?: () => void }) {
  const names = shop.services.filter((s) => sel.serviceIds.includes(s.id)).map((s) => s.name);
  const quote = sel.staffId ? sel.quotes.find((q) => q.staffId === sel.staffId) : undefined;
  const r = priceRange(shop, sel.serviceIds);
  const staffName = sel.staffId ? shop.staff.find((s) => s.id === sel.staffId)?.displayName : null;
  const price = quote ? formatMoney(quote.priceCents, shop.currency) : money(shop, r.from, r.to);
  const minutes = quote?.durationMin ?? r.minutes;
  const body = (
    <div className="grid gap-1 text-sm">
      {names.length ? <p className="flex items-center gap-1.5 font-medium"><Scissors className="size-4 shrink-0" aria-hidden />{names.join(' + ')}</p> : <p className="text-muted-foreground">Elige al menos un servicio</p>}
      {names.length > 0 && <p className="text-muted-foreground">{minutes} min · <span className="font-medium text-foreground tabular-nums">{price}</span></p>}
      {shop.booking.allowStaffSelection && sel.serviceIds.length > 0 && (
        <p className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="size-4" aria-hidden />{staffName ?? 'Cualquier barbero disponible'}</p>
      )}
      {sel.slot && (
        <p className="flex items-center gap-1.5">
          <CalendarPlus className="size-4" aria-hidden />
          <span className="first-letter:uppercase">{formatDateLong(new Date(sel.slot.start), shop.timezone)} · {formatTime(sel.slot.start, shop.timezone)}</span>
          {onChangeTime && <button type="button" className="ml-1 underline underline-offset-2" onClick={onChangeTime}>Cambiar</button>}
        </p>
      )}
    </div>
  );
  if (inline) return <div className="rounded-xl border bg-muted/40 p-4">{body}</div>;
  return (
    <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-4 backdrop-blur">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">{body}{action}</div>
    </div>
  );
}

function Done({ shop, appt, manageHref, onClose }: { shop: PublicShopDtoOutput; appt: PublicAppointmentDto; manageHref: (t: string) => string; onClose: () => void }) {
  const pending = appt.status === 'pending';
  return (
    <div className="mx-auto grid min-h-dvh max-w-md content-center gap-6 p-6 text-center">
      <span className={cn('mx-auto grid size-16 place-items-center rounded-full', pending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
        {pending ? <Hourglass className="size-8" aria-hidden /> : <CircleCheck className="size-8" aria-hidden />}
      </span>
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{pending ? 'Solicitud enviada' : `¡Listo${appt.customerName ? `, ${appt.customerName}` : ''}!`}</h1>
        <p className="text-muted-foreground">{pending ? 'La barbería revisará tu reserva y te avisará cuando la confirme.' : 'Tu cita quedó confirmada. Te enviaremos un recordatorio.'}</p>
      </div>
      <div className="grid gap-1 rounded-xl border bg-card p-4 text-left text-sm">
        <p className="font-medium first-letter:uppercase">{formatDateLong(new Date(appt.startAt), appt.timezone)} · {formatTime(appt.startAt, appt.timezone)}</p>
        <p>{appt.services.map((s) => s.name).join(' + ')} · con {appt.staff.displayName}</p>
        <p className="text-muted-foreground">{appt.shop.name}{appt.shop.address ? ` · ${appt.shop.address}` : ''}</p>
        <p className="font-semibold tabular-nums">{formatMoney(appt.totalCents, appt.currency)}</p>
      </div>
      <div className="grid gap-2">
        <a href={appt.icsUrl} className={buttonVariants({ variant: 'outline', size: 'lg' })}><CalendarPlus aria-hidden /> Agregar a mi calendario</a>
        <Link to={manageHref(appt.manageToken)} className={buttonVariants({ variant: 'ghost' })}>Ver, cambiar o cancelar mi cita</Link>
        <Button variant="link" onClick={onClose}>Volver a {shop.name}</Button>
      </div>
    </div>
  );
}

export function Avatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  if (url) return <img src={url} alt="" className={cn('size-14 shrink-0 rounded-full object-cover', className)} />;
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <span className={cn('grid size-14 shrink-0 place-items-center rounded-full bg-brand/10 text-lg font-semibold text-brand', className)} aria-hidden>{initials}</span>;
}
