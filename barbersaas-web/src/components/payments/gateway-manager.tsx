import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, CircleDashed, Copy, KeyRound, Plug, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { GatewayOverviewDto, GatewayOverviewDtoAccountsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Account = GatewayOverviewDtoAccountsItem;
type Provider = GatewayOverviewDto['providers'][number];

/** Operaciones sobre las cuentas: las de la barbería o las de la plataforma (mismo contrato). */
export interface GatewayApi {
  connect: (body: { provider: Provider['id']; credentials: Record<string, string> }) => Promise<unknown>;
  update: (id: string, body: { credentials?: Record<string, string>; isActive?: boolean }) => Promise<unknown>;
  verify: (id: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  /** Prefijo de las queries a refrescar (p. ej. "/v1/shop/payment-"). */
  invalidatePrefix: string;
}

const saved = (msg: string) => toast.success(msg);
const failed = (e: unknown) => toast.error(errorMessage(e, i18n.t));

const STATUS = {
  ok: { label: 'Conectada', icon: CircleCheck, tone: 'success' },
  error: { label: 'Error de conexión', icon: CircleAlert, tone: 'danger' },
  unverified: { label: 'Sin probar', icon: CircleDashed, tone: 'neutral' },
} as const;
const INFO_LABEL: Record<string, string> = { account: 'Cuenta', token: 'Access token', webhookSignature: 'Firma de webhooks', user: 'Usuario', password: 'Contraseña' };
/** Dónde pega la URL de notificaciones cada pasarela. */
const WEBHOOK_HELP: Record<string, string> = {
  mercadopago: 'pégala en Mercado Pago → Tus integraciones → Webhooks, evento “Pagos”',
  izipay: 'pégala en el Back Office de Izipay → Configuración → Reglas de notificaciones → “URL de notificación al final del pago” (en modo prueba y en producción)',
};

/**
 * Conectar, activar, probar y desconectar pasarelas. La usan la barbería (Pagos en línea) y el
 * superadmin (pasarela de la plataforma). Solo una cuenta activa a la vez.
 */
export function GatewayManager({ data, api, activeLabel, empty }: {
  data: GatewayOverviewDto;
  api: GatewayApi;
  /** Texto del distintivo de la cuenta activa ("Activa en caja", "Cobra las suscripciones"). */
  activeLabel: string;
  empty: ReactNode;
}) {
  const [dialog, setDialog] = useState<{ provider: Provider; account?: Account } | null>(null);
  const [picking, setPicking] = useState(false);
  const free = data.providers.filter((p) => !data.accounts.some((a) => a.provider === p.id));
  return (
    <div className="grid gap-3">
      {data.enabled && free.length > 0 && (
        <div><Button onClick={() => setPicking(true)}><Plug aria-hidden /> Conectar pasarela</Button></div>
      )}
      {data.accounts.length === 0 ? empty : (
        <ul className="grid gap-3">
          {data.accounts.map((a) => (
            <AccountCard key={a.id} account={a} api={api} activeLabel={activeLabel}
              onEdit={() => setDialog({ provider: data.providers.find((p) => p.id === a.provider)!, account: a })} />
          ))}
        </ul>
      )}
      {picking && (
        <Dialog open onClose={() => setPicking(false)} title="Conectar pasarela" className="max-w-lg">
          <div className="grid gap-2">
            {free.map((p) => (
              <button key={p.id} type="button" onClick={() => { setPicking(false); setDialog({ provider: p }); }}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-marca-300 hover:bg-marca-50/40">
                <PlugZap className="size-5 text-marca-700" aria-hidden />
                <span className="grid">
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="text-sm text-slate-500">{p.devOnly ? 'Para practicar: sin dinero real, solo en desarrollo.' : 'Tarjeta, Yape y los medios que tengas activos en tu cuenta.'}</span>
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog && <CredentialsDialog provider={dialog.provider} account={dialog.account} api={api} onClose={() => setDialog(null)} />}
    </div>
  );
}

function useApiMutation<A>(api: GatewayApi, fn: (a: A) => Promise<unknown>, msg: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => { await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(api.invalidatePrefix) }); saved(msg); },
  });
}

function AccountCard({ account: a, api, activeLabel, onEdit }: { account: Account; api: GatewayApi; activeLabel: string; onEdit: () => void }) {
  const activate = useApiMutation(api, () => api.update(a.id, { isActive: true }), `${a.providerName} quedó activa`);
  const verify = useApiMutation(api, () => api.verify(a.id), 'Conexión probada');
  const remove = useApiMutation(api, () => api.remove(a.id), 'Pasarela desconectada');
  const [confirm, setConfirm] = useState(false);
  const S = STATUS[a.status];
  const copy = async () => { await navigator.clipboard.writeText(a.webhookUrl); saved('URL copiada'); };
  return (
    <li className={cn('grid gap-3 rounded-xl border p-4', a.isActive ? 'border-marca-300 bg-marca-50/30' : 'border-slate-200 bg-white')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{a.providerName}</span>
        {a.isActive && <Badge tone="info"><ShieldCheck className="mr-1 size-3" aria-hidden />{activeLabel}</Badge>}
        <Badge tone={S.tone}><S.icon className="mr-1 size-3" aria-hidden />{S.label}</Badge>
        <Badge tone={a.mode === 'live' ? 'success' : 'warning'}>{a.mode === 'live' ? 'Producción' : 'Modo prueba'}</Badge>
        <span className="ml-auto flex flex-wrap gap-1">
          {!a.isActive && <Button size="sm" loading={activate.isPending} onClick={() => activate.mutate(undefined, { onError: failed })}>Activar</Button>}
          <Button size="sm" variant="outline" loading={verify.isPending} onClick={() => verify.mutate(undefined, { onError: failed })}><RefreshCw aria-hidden /> Probar</Button>
          {a.provider !== 'simulator' && <Button size="sm" variant="outline" onClick={onEdit}><KeyRound aria-hidden /> Credenciales</Button>}
          <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" aria-label={`Desconectar ${a.providerName}`} onClick={() => setConfirm(true)}><Trash2 aria-hidden /></Button>
        </span>
      </div>
      {a.lastError && <p className="text-sm text-red-700">{a.lastError}</p>}
      {Object.keys(a.publicInfo).length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {Object.entries(a.publicInfo).map(([k, v]) => (
            <div key={k} className="flex gap-1.5"><dt className="text-slate-500">{INFO_LABEL[k] ?? k}:</dt><dd className="font-medium text-slate-800">{v}</dd></div>
          ))}
        </dl>
      )}
      {a.provider !== 'simulator' && (
        <div className="grid gap-1">
          <span className="text-sm text-slate-600">URL de notificaciones ({WEBHOOK_HELP[a.provider] ?? 'pégala en la sección de notificaciones de tu pasarela'}):</span>
          <div className="flex gap-2">
            <Input readOnly value={a.webhookUrl} className="h-9 font-mono text-xs" aria-label="URL de notificaciones" onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="outline" onClick={copy}><Copy aria-hidden /> Copiar</Button>
          </div>
        </div>
      )}
      {confirm && (
        <Dialog open onClose={() => setConfirm(false)} title={`¿Desconectar ${a.providerName}?`} description="Los cobros pendientes se cancelan. Los ya pagados y el historial se conservan."
          footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate(undefined, { onError: failed, onSettled: () => setConfirm(false) })}>Desconectar</Button></>} />
      )}
    </li>
  );
}

function CredentialsDialog({ provider, account, api, onClose }: { provider: Provider; account?: Account; api: GatewayApi; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const save = useApiMutation(
    api,
    () => (account ? api.update(account.id, { credentials: values }) : api.connect({ provider: provider.id, credentials: values })),
    account ? 'Credenciales actualizadas' : `${provider.name} conectado`,
  );
  const missing = provider.fields.some((f) => f.required && !values[f.key]?.trim());
  const submit = () => save.mutate(undefined, { onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={account ? `Credenciales de ${provider.name}` : `Conectar ${provider.name}`} className="max-w-lg"
      description={provider.fields.length ? 'Las probamos con la pasarela antes de guardarlas, y se guardan cifradas.' : 'El simulador no necesita credenciales.'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} disabled={missing} onClick={submit}>{account ? 'Probar y guardar' : 'Probar y conectar'}</Button></>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!missing) submit(); }}>
        {save.error ? <Alert title={errorMessage(save.error, i18n.t)} /> : null}
        {provider.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? '' : ' (opcional)'}`} hint={f.help ?? undefined}>
            {(p) => <Input {...p} type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} className="font-mono" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
          </Field>
        ))}
      </form>
    </Dialog>
  );
}
