import { useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  getShopDomainControllerGetQueryKey,
  useShopDomainControllerGet,
  useShopDomainControllerRemove,
  useShopDomainControllerSet,
  useShopDomainControllerVerify,
} from '@/api/generated/endpoints';
import type { DomainDto } from '@/api/generated/model';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useShop } from '../shop-context';
import { DOMAIN_STATUS } from './domain-status';
import { Section } from './shared';
import { failed, saved } from './shared-utils';

const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' });

/** Dominio propio (reservas.tubarberia.pe) para la página de reservas: alta, DNS y verificación. */
export function DomainSettings() {
  const q = useShopDomainControllerGet();
  if (q.error) return <Alert title={errorMessage(q.error, i18n.t)} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const d = q.data;
  const S = DOMAIN_STATUS[d.status];
  return (
    <Section
      title="Dominio propio"
      description={<>Tu página de reservas con tu propia dirección. La de Cognira sigue funcionando: <a href={d.defaultUrl} target="_blank" rel="noreferrer" className="text-marca-700 underline">{d.defaultUrl.replace('https://', '')}</a></>}
      actions={<Badge tone={S.tone}><S.icon className="mr-1 size-3" aria-hidden />{S.label}</Badge>}
    >
      {!d.featureEnabled && d.status === 'none' ? <Upsell /> : d.status === 'none' ? <AddDomain /> : <Configured d={d} />}
    </Section>
  );
}

function Upsell() {
  const { barbershop } = useShop();
  return (
    <div className="grid justify-items-start gap-2 rounded-lg bg-marca-50 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-marca-900"><Sparkles className="size-4" aria-hidden /> Disponible en el plan Premium</p>
      <p className="text-slate-600">Usa una dirección como reservas.tubarberia.pe para tu página de reservas, con HTTPS incluido.</p>
      <Link to={`/s/${barbershop.slug}/configuracion/suscripcion`} className={buttonVariants({ size: 'sm' })}>Ver planes</Link>
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return (data: DomainDto) => qc.setQueryData(getShopDomainControllerGetQueryKey(), data);
}

function AddDomain() {
  const [domain, setDomain] = useState('');
  const refresh = useRefresh();
  const set = useShopDomainControllerSet({ mutation: { onSuccess: (r) => { refresh(r); saved('Dominio agregado: ahora configura tu DNS'); } } });
  const err: unknown = set.error;
  const fe = err instanceof ApiError ? err.fieldErrors() : {};
  const submit = (e: FormEvent) => { e.preventDefault(); set.mutate({ data: { domain } }); };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:max-w-lg">
      {err && !fe.domain ? <Alert title={errorMessage(err, i18n.t)} /> : null}
      <Field label="Tu dominio" error={fe.domain} hint="Recomendado: un subdominio como reservas.tubarberia.pe. Primero debes haberlo comprado.">
        {(p) => <Input {...p} placeholder="reservas.tubarberia.pe" autoComplete="off" spellCheck={false} value={domain} onChange={(e) => setDomain(e.target.value)} />}
      </Field>
      <Button type="submit" loading={set.isPending} disabled={!domain.trim()} className="justify-self-start">Agregar dominio</Button>
    </form>
  );
}

function Configured({ d }: { d: DomainDto }) {
  const refresh = useRefresh();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const verify = useShopDomainControllerVerify({
    mutation: { onSuccess: (r) => { refresh(r); if (r.status === 'verified') saved('¡Dominio verificado!'); }, onError: failed },
  });
  const remove = useShopDomainControllerRemove({
    mutation: { onSuccess: async () => { setConfirm(false); await qc.invalidateQueries({ queryKey: getShopDomainControllerGetQueryKey() }); saved('Dominio quitado'); }, onError: failed },
  });
  const copy = async (v: string) => { await navigator.clipboard.writeText(v); saved('Copiado'); };
  const i = d.instructions;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-semibold text-slate-900">{d.domain}</span>
        {d.status === 'verified' && (
          <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-marca-700 hover:underline">
            Abrir <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}><RefreshCw aria-hidden /> {d.status === 'verified' ? 'Volver a comprobar' : 'Verificar ahora'}</Button>
          <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" aria-label="Quitar dominio" onClick={() => setConfirm(true)}><Trash2 aria-hidden /></Button>
        </span>
      </div>

      {d.status === 'verified' ? (
        <Alert tone="info" title="Tu página ya funciona en tu dominio">
          El certificado HTTPS se genera solo la primera vez que alguien la abre (tarda unos segundos). Deja los registros DNS como están.
        </Alert>
      ) : d.error ? (
        <Alert title={d.error}>{d.checkedAt ? `Última comprobación: ${fmt.format(new Date(d.checkedAt))}` : null}</Alert>
      ) : null}

      {i && (
        <div className="grid gap-2">
          <p className="text-sm text-slate-600">
            En el panel de tu proveedor de dominio (Cloudflare, GoDaddy, Punto.pe…), crea estos dos registros y luego pulsa «Verificar ahora». Los cambios de DNS pueden tardar desde minutos hasta unas horas.
          </p>
          <Table>
            <thead><tr><Th>Tipo</Th><Th>Nombre</Th><Th>Valor</Th></tr></thead>
            <tbody>
              {[{ type: 'TXT', name: i.txt.name, value: i.txt.value }, { type: i.point.type, name: i.point.name, value: i.point.value }].map((r) => (
                <tr key={r.type}>
                  <Td className="font-medium">{r.type}</Td>
                  <Td><CopyValue value={r.name} onCopy={copy} /></Td>
                  <Td><CopyValue value={r.value} onCopy={copy} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {i.point.type === 'A' && <p className="text-xs text-slate-500">Es un dominio raíz: usa registros A. Si tu proveedor permite «CNAME flattening» (Cloudflare), también puedes usar un CNAME.</p>}
          {i.point.type === 'CNAME' && <p className="text-xs text-slate-500">En Cloudflare, deja la nube en gris («Solo DNS»).</p>}
        </div>
      )}

      {confirm && (
        <Dialog open onClose={() => setConfirm(false)} title="¿Quitar tu dominio?" description={`${d.domain} dejará de mostrar tu página. La dirección de Cognira sigue funcionando.`}
          footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>Quitar</Button></>} />
      )}
    </div>
  );
}

function CopyValue({ value, onCopy }: { value: string; onCopy: (v: string) => void }) {
  return (
    <span className="flex items-center gap-1">
      <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs">{value}</code>
      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Copiar ${value}`} onClick={() => onCopy(value)}><Copy aria-hidden /></Button>
    </span>
  );
}
