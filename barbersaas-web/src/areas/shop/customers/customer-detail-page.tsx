import { keepPreviousData } from '@tanstack/react-query';
import { ArrowLeft, Ban, CalendarPlus, Cake, Combine, ImagePlus, MessageCircle, Pencil, Trash2, UserCheck, X } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { isApiError } from '@/api/errors';
import {
  uploadsControllerUpload,
  useCustomersControllerAddNote,
  useCustomersControllerBlock,
  useCustomersControllerGet,
  useCustomersControllerHistory,
  useCustomersControllerList,
  useCustomersControllerMerge,
  useCustomersControllerNotes,
  useCustomersControllerRemove,
  useCustomersControllerRemoveNote,
  useCustomersControllerUnblock,
  useStaffControllerList,
} from '@/api/generated/endpoints';
import type { CustomerDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/table';
import { formatTime, toWall } from '@/lib/dates';
import { formatPhone } from '@/lib/phone';
import { errorMessage } from '@/lib/errors';
import { useDebounced } from '@/lib/use-debounced';
import { formatMoney } from '@/lib/utils';
import { useAgendaAccess, whatsappLink } from '../agenda/agenda-utils';
import { NewAppointmentDialog } from '../agenda/new-appointment-dialog';
import { STATUS, toneStyle } from '../agenda/status';
import { useCan, useShop } from '../shop-context';
import { failed, saved, useRefreshShop } from '../settings/shared-utils';
import { CustomerFormDialog } from './customer-form';
import { birthdayInfo, relativeDays, shortDate } from './format';

type Dialogs = 'edit' | 'block' | 'merge' | 'delete' | 'book' | null;

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const q = useCustomersControllerGet(id);
  if (q.error) {
    return (
      <div className="mx-auto grid max-w-5xl gap-4 p-4 sm:p-6">
        <BackLink />
        <Alert title={isApiError(q.error as unknown, 'NOT_FOUND') ? 'Este cliente no existe o fue eliminado.' : errorMessage(q.error, t)} />
      </div>
    );
  }
  if (!q.data) return <div className="mx-auto grid max-w-5xl gap-4 p-4 sm:p-6"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  return <CustomerDetail c={q.data} />;
}

function BackLink() {
  return (
    <Link to=".." relative="path" className="inline-flex items-center gap-1.5 justify-self-start text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> Clientes
    </Link>
  );
}

function CustomerDetail({ c }: { c: CustomerDto }) {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const can = useCan();
  const manage = can('customers.manage');
  const agenda = useAgendaAccess();
  const navigate = useNavigate();
  const refresh = useRefreshShop();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const unblock = useCustomersControllerUnblock({ mutation: { onSuccess: async () => { await refresh(); saved('Cliente desbloqueado'); }, onError: failed } });
  const staff = useStaffControllerList({}, { query: { enabled: agenda.canCreate } });

  const wa = whatsappLink(c.phone);
  const bday = c.birthday ? birthdayInfo(c.birthday, locale) : null;
  const s = c.stats;
  const nextReturn = s.lastVisitAt && s.avgDaysBetweenVisits ? new Date(new Date(s.lastVisitAt).getTime() + s.avgDaysBetweenVisits * 86_400_000).toISOString() : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-5 p-4 sm:p-6">
      <BackLink />

      <header className="flex flex-wrap items-start gap-4">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{c.fullName}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums">{formatPhone(c.phone) ?? 'Sin teléfono'}</span>
            {c.email && <span>{c.email}</span>}
            {bday && <span className="inline-flex items-center gap-1"><Cake className="size-3.5" aria-hidden />{bday.label}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {c.isBlocked && <Badge tone="danger"><Ban className="mr-1 size-3" aria-hidden />Bloqueado: no puede reservar online</Badge>}
            {bday?.soon && <Badge tone="info"><Cake className="mr-1 size-3" aria-hidden />Cumpleaños esta semana</Badge>}
            {c.noShowCount > 0 && <Badge tone="warning">{c.noShowCount} inasistencia{c.noShowCount > 1 ? 's' : ''}</Badge>}
            {c.hasAccount && <Badge>Tiene cuenta</Badge>}
            {!c.waOptIn && <Badge>No recibe WhatsApp</Badge>}
            {c.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
              <MessageCircle aria-hidden /> WhatsApp
            </a>
          )}
          {agenda.canCreate && !c.isBlocked && <Button variant="brand" disabled={!staff.data} onClick={() => setDialog('book')}><CalendarPlus aria-hidden /> Agendar</Button>}
          {manage && <Button variant="outline" onClick={() => setDialog('edit')}><Pencil aria-hidden /> Editar</Button>}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Visitas" value={String(s.visits)} />
        <Stat label="Total gastado" value={formatMoney(s.totalSpentCents, shop.barbershop.currency, locale)} />
        <Stat label="Última visita" value={relativeDays(s.lastVisitAt, locale) ?? 'Nunca'} hint={s.lastVisitAt ? shortDate(s.lastVisitAt, tz, locale) : undefined} />
        <Stat
          label={s.nextAppointmentAt ? 'Próxima cita' : 'Suele volver'}
          value={s.nextAppointmentAt ? (relativeDays(s.nextAppointmentAt, locale) ?? '') : nextReturn ? (relativeDays(nextReturn, locale) ?? '—') : '—'}
          hint={
            s.nextAppointmentAt
              ? `${shortDate(s.nextAppointmentAt, tz, locale)} · ${formatTime(s.nextAppointmentAt, tz, locale)}`
              : s.avgDaysBetweenVisits
                ? `cada ~${Math.round(s.avgDaysBetweenVisits)} días`
                : 'con 2+ visitas se calcula'
          }
        />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <History id={c.id} />
        <Notes id={c.id} />
      </div>

      {manage && (
        <section className="grid gap-3 rounded-xl border p-4">
          <h2 className="font-semibold">Acciones</h2>
          <div className="flex flex-wrap gap-2">
            {c.isBlocked ? (
              <Button variant="outline" loading={unblock.isPending} onClick={() => unblock.mutate({ id: c.id })}><UserCheck aria-hidden /> Desbloquear</Button>
            ) : (
              <Button variant="outline" onClick={() => setDialog('block')}><Ban aria-hidden /> Bloquear</Button>
            )}
            <Button variant="outline" onClick={() => setDialog('merge')}><Combine aria-hidden /> Fusionar con un duplicado</Button>
            <Button variant="ghost" className="text-destructive" onClick={() => setDialog('delete')}><Trash2 aria-hidden /> Eliminar</Button>
          </div>
        </section>
      )}

      {dialog === 'edit' && <CustomerFormDialog customer={c} onClose={() => setDialog(null)} />}
      {dialog === 'block' && <BlockDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'merge' && <MergeDialog c={c} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteDialog c={c} onClose={() => setDialog(null)} onDeleted={() => navigate('..', { relative: 'path', replace: true })} />}
      {dialog === 'book' && staff.data && (
        <NewAppointmentDialog
          staff={staff.data.filter((x) => x.isActive)}
          start={nextQuarter(toWall(new Date(), tz))}
          customer={{ id: c.id, fullName: c.fullName, phone: c.phone }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums first-letter:uppercase">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function History({ id }: { id: string }) {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const shop = useShop();
  const tz = shop.barbershop.timezone;
  const [page, setPage] = useState(1);
  const h = useCustomersControllerHistory(id, { page, pageSize: 10 }, { query: { placeholderData: keepPreviousData } });
  return (
    <section className="grid content-start gap-3">
      <h2 className="font-semibold">Historial de citas</h2>
      {!h.data ? <Skeleton className="h-48" /> : h.data.items.length === 0 ? (
        <EmptyState title="Sin citas todavía" />
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {h.data.items.map((a) => {
              const S = STATUS[a.status];
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <span className="grid w-28 shrink-0">
                    <span className="font-medium">{shortDate(a.startAt, tz, locale)}</span>
                    <span className="text-muted-foreground tabular-nums">{formatTime(a.startAt, tz, locale)}</span>
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{a.services.join(' + ')}</span>
                    <span className="truncate text-muted-foreground">{a.staff.displayName}</span>
                  </span>
                  <span className="tabular-nums">{formatMoney(a.totalCents, shop.barbershop.currency, locale)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-l-4 px-2 py-0.5 text-xs font-medium" style={toneStyle(S.tone)}>
                    <S.icon className="size-3" aria-hidden /> {S.label}
                  </span>
                </li>
              );
            })}
          </ul>
          {h.data.total > h.data.pageSize && <Pagination page={h.data.page} pageSize={h.data.pageSize} total={h.data.total} onPage={setPage} />}
        </>
      )}
    </section>
  );
}

/** Notas del equipo ("degradado bajo, máquina 1") con foto opcional del corte. */
function Notes({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';
  const shop = useShop();
  const can = useCan();
  const notes = useCustomersControllerNotes(id);
  const refetch = () => notes.refetch();
  const add = useCustomersControllerAddNote({ mutation: { onSuccess: async () => { await refetch(); setBody(''); setImage(null); }, onError: failed } });
  const remove = useCustomersControllerRemoveNote({ mutation: { onSuccess: () => refetch(), onError: failed } });
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      setImage((await uploadsControllerUpload({ file: f }, { kind: 'customer' })).url);
    } catch (e) {
      failed(e);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) add.mutate({ id, data: { body: body.trim(), imageUrl: image } });
  };

  return (
    <section className="grid content-start gap-3">
      <h2 className="font-semibold">Notas</h2>
      <form onSubmit={submit} className="grid gap-2 rounded-xl border bg-card p-3">
        <Textarea aria-label="Nueva nota" className="min-h-16" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ej.: degradado bajo, máquina 1 a los costados" />
        {image && (
          <div className="relative justify-self-start">
            <img src={image} alt="Foto adjunta" className="h-20 w-20 rounded-lg object-cover" />
            <button type="button" className="absolute -top-2 -right-2 rounded-full border bg-card p-0.5" aria-label="Quitar foto" onClick={() => setImage(null)}><X className="size-3.5" aria-hidden /></button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" loading={uploading} onClick={() => file.current?.click()}><ImagePlus aria-hidden /> Foto del corte</Button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void upload(e.target.files?.[0])} />
          <Button type="submit" size="sm" disabled={!body.trim() || uploading} loading={add.isPending}>Agregar nota</Button>
        </div>
      </form>
      {!notes.data ? <Skeleton className="h-24" /> : notes.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin notas. Anota preferencias para que cualquier barbero las vea.</p>
      ) : (
        <ul className="grid gap-2">
          {notes.data.map((n) => {
            const mine = n.author?.membershipId === shop.membershipId;
            return (
              <li key={n.id} className="grid gap-2 rounded-xl border bg-card p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                {n.imageUrl && (
                  <a href={n.imageUrl} target="_blank" rel="noreferrer" className="justify-self-start">
                    <img src={n.imageUrl} alt="Foto del corte" loading="lazy" className="h-28 w-28 rounded-lg object-cover" />
                  </a>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{n.author?.fullName ?? 'Sistema'} · {relativeDays(n.createdAt, locale)}</span>
                  {(mine || can('customers.manage')) && (
                    <button type="button" className="ml-auto rounded p-1 hover:bg-muted hover:text-destructive" aria-label="Borrar nota" disabled={remove.isPending}
                      onClick={() => remove.mutate({ id, noteId: n.id })}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {add.error ? <Alert title={errorMessage(add.error, t)} /> : null}
    </section>
  );
}

function BlockDialog({ c, onClose }: { c: CustomerDto; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [reason, setReason] = useState('');
  const block = useCustomersControllerBlock({ mutation: { onSuccess: async () => { await refresh(); saved('Cliente bloqueado'); onClose(); } } });
  return (
    <Dialog open onClose={onClose} title={`Bloquear a ${c.fullName}`}
      description="No podrá reservar por la página pública. Sus citas actuales se mantienen; desde el panel sí se le puede agendar."
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button variant="destructive" type="submit" form="block-c" loading={block.isPending}>Bloquear</Button></>}>
      <form id="block-c" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); block.mutate({ id: c.id, data: { reason: reason.trim() } }); }}>
        {block.error ? <Alert title={errorMessage(block.error, t)} /> : null}
        <Field label="Motivo (solo lo ve el equipo)">
          {(p) => <Input {...p} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="3 inasistencias sin avisar" />}
        </Field>
      </form>
    </Dialog>
  );
}

/** Fusionar: el duplicado elegido se elimina y sus citas, notas y mensajes pasan a este cliente. */
function MergeDialog({ c, onClose }: { c: CustomerDto; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [source, setSource] = useState<{ id: string; fullName: string; phone: string | null } | null>(null);
  const found = useCustomersControllerList({ q: dq, pageSize: 6 }, { query: { enabled: dq.length >= 2 } });
  const merge = useCustomersControllerMerge({ mutation: { onSuccess: async () => { await refresh(); saved('Clientes fusionados'); onClose(); } } });
  const options = (found.data?.items ?? []).filter((x) => x.id !== c.id);
  return (
    <Dialog open onClose={onClose} title="Fusionar con un duplicado"
      description={<>Busca el registro duplicado. Sus citas, notas y mensajes pasan a <strong>{c.fullName}</strong> y el duplicado se elimina.</>}
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button variant="destructive" disabled={!source} loading={merge.isPending} onClick={() => source && merge.mutate({ id: c.id, data: { sourceId: source.id } })}>Fusionar</Button></>}>
      <div className="grid gap-3 text-sm">
        {merge.error ? <Alert title={errorMessage(merge.error, t)} /> : null}
        {source ? (
          <Alert tone="info" title={`Se fusionará «${source.fullName}» (${formatPhone(source.phone) ?? 'sin teléfono'}) dentro de «${c.fullName}».`}>
            <Button variant="link" className="h-auto px-0" onClick={() => setSource(null)}>Elegir otro</Button>
          </Alert>
        ) : (
          <>
            <Field label="Buscar duplicado">{(p) => <Input {...p} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o teléfono" />}</Field>
            {dq.length >= 2 && (
              options.length === 0 ? <p className="text-muted-foreground">{found.isFetching ? 'Buscando…' : 'Sin resultados.'}</p> : (
                <ul className="divide-y rounded-lg border">
                  {options.map((x) => (
                    <li key={x.id}>
                      <button type="button" className="grid w-full p-2.5 text-left hover:bg-muted" onClick={() => setSource({ id: x.id, fullName: x.fullName, phone: x.phone })}>
                        <span className="font-medium">{x.fullName}</span>
                        <span className="text-muted-foreground tabular-nums">{formatPhone(x.phone) ?? 'Sin teléfono'} · {x.stats.visits} visitas</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function DeleteDialog({ c, onClose, onDeleted }: { c: CustomerDto; onClose: () => void; onDeleted: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  // Primero se sale de la ficha: si se refresca antes, sus consultas piden un cliente que ya no existe (404).
  const remove = useCustomersControllerRemove({ mutation: { onSuccess: () => { onDeleted(); saved('Cliente eliminado'); void refresh(); } } });
  return (
    <Dialog open onClose={onClose} title={`¿Eliminar a ${c.fullName}?`}
      description="Se quita de la lista de clientes; su historial se conserva en los reportes. Si tiene citas futuras, primero hay que cancelarlas."
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: c.id })}>Eliminar</Button></>}>
      {remove.error ? <Alert title={errorMessage(remove.error, t)} /> : null}
    </Dialog>
  );
}

function nextQuarter(wall: Date): Date {
  const d = new Date(wall);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
}
