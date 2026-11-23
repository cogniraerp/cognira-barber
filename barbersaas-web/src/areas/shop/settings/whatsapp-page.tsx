import { keepPreviousData } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, RotateCcw, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isApiError } from '@/api/errors';
import {
  useShopNotificationsControllerGetSettings,
  useShopNotificationsControllerGetWhatsApp,
  useShopNotificationsControllerLogs,
  useShopNotificationsControllerMarkSent,
  useShopNotificationsControllerPreview,
  useShopNotificationsControllerResetTemplate,
  useShopNotificationsControllerRetry,
  useShopNotificationsControllerSetSettings,
  useShopNotificationsControllerSetTemplate,
  useShopNotificationsControllerSetWhatsApp,
  useShopNotificationsControllerSubmit,
  useShopNotificationsControllerTemplates,
  useShopNotificationsControllerTest,
  useShopNotificationsControllerUsage,
  useShopNotificationsControllerVerify,
} from '@/api/generated/endpoints';
import type { NotificationSettingsDto, WhatsAppConfigDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { PageHeader, Pagination } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Section } from './shared';
import { failed, saved, useRefreshShop } from './shared-utils';

const EVENT_LABELS: Record<string, string> = {
  booking_requested: 'Solicitud recibida (aprobación manual)', booking_confirmed: 'Reserva confirmada', reminder: 'Recordatorio',
  rescheduled: 'Reprogramación', canceled: 'Cancelación', staff_new_booking: 'Aviso al barbero de nueva reserva',
};

export function WhatsAppPage() {
  const [tab, setTab] = useState<'conexion' | 'mensajes' | 'plantillas' | 'registro'>('conexion');
  const tabs = [['conexion', 'Conexión'], ['mensajes', 'Qué se envía'], ['plantillas', 'Plantillas'], ['registro', 'Registro']] as const;
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="WhatsApp y mensajes" subtitle="Cómo se envían, qué se envía y con qué texto; más el registro de envíos." />
      <Tabs idBase="mensajes" label="Secciones" value={tab} onChange={setTab} items={tabs.map(([id, label]) => ({ id, label }))} />
      <TabPanel idBase="mensajes" id={tab}>
        {tab === 'conexion' && <Connection />}
        {tab === 'mensajes' && <NotificationSettingsForm />}
        {tab === 'plantillas' && <Templates />}
        {tab === 'registro' && <MessageLog />}
      </TabPanel>
    </div>
  );
}

export function Connection({ onSaved }: { onSaved?: () => void }) {
  const cfg = useShopNotificationsControllerGetWhatsApp({ query: {} });
  if (!cfg.data) return <Skeleton className="h-64" />;
  return <ConnectionEditor initial={cfg.data} onSaved={onSaved} />;
}

function ConnectionEditor({ initial, onSaved }: { initial: WhatsAppConfigDto; onSaved?: () => void }) {
  const refresh = useRefreshShop();
  const cfg = useShopNotificationsControllerGetWhatsApp({ query: { initialData: initial } });
  const usage = useShopNotificationsControllerUsage({ query: {} });
  const [provider, setProvider] = useState(initial.provider);
  const [cloud, setCloud] = useState({ phoneNumberId: initial.publicFields.phoneNumberId ?? '', wabaId: initial.publicFields.wabaId ?? '', accessToken: '' });
  const [twilio, setTwilio] = useState({ accountSid: initial.publicFields.accountSid ?? '', authToken: '', fromNumber: initial.publicFields.fromNumber ?? '' });
  const [testTo, setTestTo] = useState('');
  const set = useShopNotificationsControllerSetWhatsApp();
  const verify = useShopNotificationsControllerVerify({ mutation: { onSuccess: async (r) => { await refresh(); if (r.status === 'ok') { saved('Conexión verificada'); onSaved?.(); } } } });
  const test = useShopNotificationsControllerTest();
  if (!cfg.data) return <Skeleton className="h-64" />;
  const setError: unknown = set.error;
  const fe = isApiError(setError) ? setError.fieldErrors() : {};
  const sameProvider = cfg.data.provider === provider && cfg.data.hasCredentials;

  const saveAndVerify = async () => {
    const data =
      provider === 'cloud_api' ? { provider, ...(cloud.accessToken || !sameProvider ? { cloudApi: cloud } : {}) }
      : provider === 'twilio' ? { provider, ...(twilio.authToken || !sameProvider ? { twilio } : {}) }
      : { provider };
    const ok = await set.mutateAsync({ data }).then(() => true, () => false);
    if (ok) verify.mutate();
  };

  const OPTIONS = [
    ['platform', 'Número de Cognira Barber', 'Los mensajes salen del número de la plataforma con el nombre de tu barbería. Sin configurar nada.'],
    ['wa_me', 'Enlace wa.me (manual)', 'Sin API: cada mensaje queda listo en el Registro con un enlace; lo envías tú desde tu WhatsApp con un toque.'],
    ['cloud_api', 'WhatsApp Cloud API (tu número)', 'Tu propio número de WhatsApp Business conectado a Meta. Requiere una cuenta de Meta Business.'],
    ['twilio', 'Twilio', 'Si ya usas Twilio para WhatsApp.'],
  ] as const;

  return (
    <div className="grid gap-4">
      <Section
        title="Cómo se envían los mensajes"
        actions={<StatusPill status={cfg.data.status} phone={cfg.data.displayPhone} />}
      >
        <fieldset className="grid gap-2">
          <legend className="sr-only">Proveedor</legend>
          {OPTIONS.map(([v, title, desc]) => (
            <label key={v} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', provider === v && 'border-foreground bg-muted/40')}>
              <input type="radio" name="provider" className="mt-1" checked={provider === v} onChange={() => setProvider(v)} />
              <span className="grid gap-0.5"><span className="font-medium">{title}</span><span className="text-sm text-muted-foreground">{desc}</span></span>
            </label>
          ))}
        </fieldset>
        {provider === 'cloud_api' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone Number ID" error={fe['cloudApi.phoneNumberId']}>{(p) => <Input {...p} value={cloud.phoneNumberId} onChange={(e) => setCloud({ ...cloud, phoneNumberId: e.target.value })} inputMode="numeric" />}</Field>
            <Field label="WhatsApp Business Account ID" error={fe['cloudApi.wabaId']}>{(p) => <Input {...p} value={cloud.wabaId} onChange={(e) => setCloud({ ...cloud, wabaId: e.target.value })} inputMode="numeric" />}</Field>
            <div className="sm:col-span-2"><Field label="Access token" error={fe['cloudApi.accessToken']} hint={sameProvider ? 'Guardado y cifrado. Déjalo vacío para conservarlo.' : 'Se guarda cifrado y nunca se vuelve a mostrar.'}>{(p) => <Input {...p} type="password" autoComplete="off" value={cloud.accessToken} onChange={(e) => setCloud({ ...cloud, accessToken: e.target.value })} />}</Field></div>
          </div>
        )}
        {provider === 'twilio' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account SID" error={fe['twilio.accountSid']}>{(p) => <Input {...p} value={twilio.accountSid} onChange={(e) => setTwilio({ ...twilio, accountSid: e.target.value })} />}</Field>
            <Field label="Número de WhatsApp" error={fe['twilio.fromNumber']}>{(p) => <Input {...p} value={twilio.fromNumber} onChange={(e) => setTwilio({ ...twilio, fromNumber: e.target.value })} placeholder="+14155550100" />}</Field>
            <div className="sm:col-span-2"><Field label="Auth token" error={fe['twilio.authToken']} hint={sameProvider ? 'Guardado y cifrado. Déjalo vacío para conservarlo.' : 'Se guarda cifrado.'}>{(p) => <Input {...p} type="password" autoComplete="off" value={twilio.authToken} onChange={(e) => setTwilio({ ...twilio, authToken: e.target.value })} />}</Field></div>
          </div>
        )}
        {set.error && !Object.keys(fe).length ? <Alert title={errorMessage(set.error, i18n.t)} /> : null}
        {cfg.data.status === 'error' && cfg.data.lastError && <Alert title="No se pudo verificar la conexión">{cfg.data.lastError}</Alert>}
        <div className="flex justify-end"><Button loading={set.isPending || verify.isPending} onClick={() => void saveAndVerify()}>Guardar y verificar</Button></div>
      </Section>

      <Section title="Probar">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); test.mutate({ data: { to: testTo } }); }}>
          <Field label="Enviar un mensaje de prueba a">{(p) => <Input {...p} type="tel" required value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="987 654 321" />}</Field>
          <Button type="submit" variant="outline" loading={test.isPending}><Send aria-hidden /> Enviar prueba</Button>
        </form>
        {test.data && (test.data.status === 'manual' && test.data.actionUrl
          ? <a href={test.data.actionUrl} target="_blank" rel="noreferrer" className="text-sm underline">Abrir WhatsApp para enviarlo <ExternalLink className="inline size-3" aria-hidden /></a>
          : <p className="text-sm text-green-800">Enviado ✔ ({test.data.provider})</p>)}
        {test.error ? <Alert title={errorMessage(test.error, i18n.t)} /> : null}
        {usage.data && (
          <p className="text-sm text-muted-foreground">
            Este mes: <strong className="text-foreground">{usage.data.whatsapp.used.toLocaleString('es-PE')}</strong>
            {usage.data.whatsapp.limit !== null ? ` de ${usage.data.whatsapp.limit.toLocaleString('es-PE')}` : ''} mensajes de WhatsApp de tu plan
            {usage.data.whatsapp.queued ? ` · ${usage.data.whatsapp.queued} en cola` : ''}.
          </p>
        )}
      </Section>
    </div>
  );
}

function StatusPill({ status, phone }: { status: string; phone: string | null }) {
  if (status === 'ok') return <Badge tone="success" className="gap-1"><CheckCircle2 className="size-3" aria-hidden /> Conectado{phone ? ` · ${phone}` : ''}</Badge>;
  if (status === 'error') return <Badge tone="danger" className="gap-1"><XCircle className="size-3" aria-hidden /> Error</Badge>;
  return <Badge tone="warning">Sin verificar</Badge>;
}

function NotificationSettingsForm() {
  const s = useShopNotificationsControllerGetSettings({ query: {} });
  if (!s.data) return <Skeleton className="h-64" />;
  return <NotificationSettingsEditor initial={s.data as NotificationSettingsDto} />;
}

function NotificationSettingsEditor({ initial }: { initial: NotificationSettingsDto }) {
  const refresh = useRefreshShop();
  const save = useShopNotificationsControllerSetSettings({ mutation: { onSuccess: async () => { await refresh(); saved(); }, onError: failed } });
  const [f, setF] = useState<NotificationSettingsDto>(initial);
  if (!f.events) return <Skeleton className="h-64" />;
  const events = f.events as Record<string, { whatsapp: boolean; email: boolean }>;
  const hours = (f.reminderHours ?? [24]) as number[];
  const toggleHour = (h: number) => setF({ ...f, reminderHours: (hours.includes(h) ? hours.filter((x) => x !== h) : [...hours, h].sort((a, b) => b - a).slice(0, 3)) as NotificationSettingsDto['reminderHours'] });
  return (
    <Section title="Qué mensajes se envían" description="Los walk-in (clientes sin reserva) no reciben mensajes.">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead><tr><th scope="col" className="border-b p-2 text-left font-medium">Mensaje</th><th scope="col" className="border-b p-2 font-medium">WhatsApp</th><th scope="col" className="border-b p-2 font-medium">Email</th></tr></thead>
          <tbody>
            {Object.keys(EVENT_LABELS).map((ev) => (
              <tr key={ev}>
                <th scope="row" className="border-b p-2 text-left font-normal">{EVENT_LABELS[ev]}</th>
                {(['whatsapp', 'email'] as const).map((ch) => (
                  <td key={ch} className="border-b p-2 text-center">
                    <input type="checkbox" className="size-4" aria-label={`${EVENT_LABELS[ev]} por ${ch}`} checked={Boolean(events[ev]?.[ch])} onChange={(e) => setF({ ...f, events: { ...events, [ev]: { ...events[ev]!, [ch]: e.target.checked } } as NotificationSettingsDto['events'] })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Enviar recordatorios (máximo 3)</legend>
        <div className="flex flex-wrap gap-3">
          {[48, 24, 12, 6, 3, 2, 1].map((h) => <Checkbox key={h} label={h >= 24 ? `${h / 24} día${h > 24 ? 's' : ''} antes` : `${h} h antes`} checked={hours.includes(h)} onChange={() => toggleHour(h)} />)}
        </div>
      </fieldset>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate({ data: f })}>Guardar</Button></div>
    </Section>
  );
}

function Templates() {
  const list = useShopNotificationsControllerTemplates({ query: {} });
  const cfg = useShopNotificationsControllerGetWhatsApp({ query: {} });
  const [editing, setEditing] = useState<{ event: string; channel: string } | null>(null);
  if (!list.data) return <Skeleton className="h-64" />;
  const tpl = editing && list.data.templates.find((x) => x.event === editing.event && x.channel === editing.channel);
  return (
    <Section title="Plantillas" description={<>Variables disponibles: {list.data.variables.map((v) => <code key={v} className="mr-1 text-xs">{`{{${v}}}`}</code>)}</>}>
      <ul className="divide-y rounded-lg border">
        {list.data.templates.map((x) => (
          <li key={`${x.event}-${x.channel}`} className="flex flex-wrap items-center gap-2 p-3">
            <span className="grid min-w-0 flex-1">
              <span className="font-medium">{EVENT_LABELS[x.event]} · {x.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
              <span className="truncate text-sm text-muted-foreground">{x.body}</span>
            </span>
            {x.source === 'custom' && <Badge tone="info">Personalizada</Badge>}
            {x.channel === 'whatsapp' && x.providerStatus !== 'n_a' && <Badge tone={x.providerStatus === 'approved' ? 'success' : x.providerStatus === 'rejected' ? 'danger' : 'warning'}>Meta: {x.providerStatus === 'approved' ? 'aprobada' : x.providerStatus === 'rejected' ? 'rechazada' : 'en revisión'}</Badge>}
            <Button variant="outline" size="sm" onClick={() => setEditing({ event: x.event, channel: x.channel })}>Editar</Button>
          </li>
        ))}
      </ul>
      {tpl && <TemplateDialog tpl={tpl} cloudApi={cfg.data?.provider === 'cloud_api' && cfg.data.status === 'ok'} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function TemplateDialog({ tpl, cloudApi, onClose }: { tpl: { event: string; channel: string; subject: string | null; body: string; source: string }; cloudApi: boolean; onClose: () => void }) {
  const refresh = useRefreshShop();
  const [subject, setSubject] = useState(tpl.subject ?? '');
  const [body, setBody] = useState(tpl.body);
  const preview = useShopNotificationsControllerPreview();
  const save = useShopNotificationsControllerSetTemplate({ mutation: { onSuccess: async () => { await refresh(); saved(); onClose(); } } });
  const reset = useShopNotificationsControllerResetTemplate({ mutation: { onSuccess: async () => { await refresh(); onClose(); }, onError: failed } });
  const submit = useShopNotificationsControllerSubmit({ mutation: { onSuccess: async () => { await refresh(); saved('Enviada a Meta para aprobación'); }, onError: failed } });
  const { mutate: runPreview } = preview;
  useEffect(() => {
    const id = setTimeout(() => runPreview({ data: { event: tpl.event as 'reminder', channel: tpl.channel as 'whatsapp', body, subject: tpl.channel === 'email' ? subject : undefined } }), 300);
    return () => clearTimeout(id);
  }, [body, subject, tpl.event, tpl.channel, runPreview]);
  return (
    <Dialog open onClose={onClose} title={`${EVENT_LABELS[tpl.event]} · ${tpl.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}`} className="max-w-2xl"
      footer={<>
        {tpl.source === 'custom' && <Button variant="ghost" className="mr-auto" loading={reset.isPending} onClick={() => reset.mutate({ event: tpl.event as 'reminder', channel: tpl.channel as 'whatsapp' })}><RotateCcw aria-hidden /> Volver al original</Button>}
        {cloudApi && tpl.channel === 'whatsapp' && <Button variant="outline" loading={submit.isPending} onClick={() => submit.mutate({ event: tpl.event })}>Enviar a aprobación de Meta</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ event: tpl.event as 'reminder', channel: tpl.channel as 'whatsapp', data: { body, subject: tpl.channel === 'email' ? subject : undefined } })}>Guardar</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-3">
          {save.error ? <Alert title={errorMessage(save.error, i18n.t)} /> : null}
          {tpl.channel === 'email' && <Field label="Asunto">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>}
          <Field label="Mensaje" hint={tpl.channel === 'whatsapp' ? `${body.length}/1024` : undefined}>{(p) => <Textarea {...p} className="min-h-48 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
          {tpl.channel === 'whatsapp' && <p className="text-xs text-muted-foreground">Con Cloud API, los mensajes que inicia la barbería (como recordatorios) necesitan una plantilla aprobada por Meta. Editarla anula la aprobación.</p>}
        </div>
        <div className="grid content-start gap-1.5">
          <span className="text-sm font-medium">Vista previa</span>
          <div className="rounded-xl bg-[#e5ddd5] p-3">
            {preview.data?.subject && <p className="mb-1 text-xs font-semibold">{preview.data.subject}</p>}
            <p className="rounded-lg bg-white p-3 text-sm whitespace-pre-wrap shadow-sm">{preview.data?.body ?? '…'}</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function MessageLog() {
  const refresh = useRefreshShop();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState('');
  const logs = useShopNotificationsControllerLogs({ page, pageSize, status: (status || undefined) as 'sent' }, { query: { placeholderData: keepPreviousData, refetchInterval: 15_000 } });
  const mark = useShopNotificationsControllerMarkSent({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const retry = useShopNotificationsControllerRetry({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { queued: 'neutral', sending: 'info', manual: 'warning', sent: 'info', delivered: 'success', read: 'success', failed: 'danger' };
  const LABEL: Record<string, string> = { queued: 'En cola', sending: 'Enviando', manual: 'Por enviar', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Falló' };
  return (
    <Section title="Registro de mensajes" actions={<Select aria-label="Estado" className="h-9 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Todos</option>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}>
      {!logs.data ? <Skeleton className="h-48" /> : logs.data.items.length === 0 ? <p className="text-sm text-muted-foreground">Sin mensajes.</p> : (
        <>
          <ul className="divide-y rounded-lg border">
            {logs.data.items.map((m) => (
              <li key={m.id} className="grid gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[m.status]}>{LABEL[m.status]}</Badge>
                  <span className="font-medium">{EVENT_LABELS[m.event]}</span>
                  <span className="text-muted-foreground">· {m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} → {m.to}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(m.sentAt ?? m.scheduledFor ?? m.createdAt))}</span>
                </div>
                {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                <div className="flex gap-2">
                  {m.status === 'manual' && m.actionUrl && <a href={m.actionUrl} target="_blank" rel="noreferrer" className="text-sm underline" onClick={() => setTimeout(() => mark.mutate({ id: m.id }), 500)}>Enviar por WhatsApp <ExternalLink className="inline size-3" aria-hidden /></a>}
                  {m.status === 'failed' && <Button size="sm" variant="outline" onClick={() => retry.mutate({ id: m.id })}>Reintentar</Button>}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={logs.data.page} pageSize={logs.data.pageSize} total={logs.data.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        </>
      )}
    </Section>
  );
}
