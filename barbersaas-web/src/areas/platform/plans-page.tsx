import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { usePlansControllerCreate, usePlansControllerList, usePlansControllerRemove, usePlansControllerUpdate } from '@/api/generated/endpoints';
import type { PlanListDtoItem } from '@/api/generated/model';

type PlanDtoOutput = PlanListDtoItem;
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

const LIMITS = [
  ['staff', 'Barberos'], ['locations', 'Sedes'], ['services', 'Servicios'],
  ['bookingsPerMonth', 'Reservas/mes'], ['whatsappPerMonth', 'WhatsApp/mes'], ['storageMb', 'Almacenamiento (MB)'],
] as const;
const FEATURES = [
  ['loyalty', 'Fidelización'], ['advancedReports', 'Reportes avanzados'], ['onlinePayments', 'Pagos online'],
  ['multiLocation', 'Multi-sede'], ['api', 'API pública'], ['customDomain', 'Dominio propio'], ['removeBranding', 'Sin "Powered by"'],
] as const;

export function PlansPage() {
  const { t } = useTranslation();
  const isSuper = useAuth((s) => s.user?.platformRole === 'superadmin');
  const plans = usePlansControllerList({ query: {} });
  const [editing, setEditing] = useState<PlanDtoOutput | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PlanDtoOutput | null>(null);

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{t('nav.plans')}</h1>
        {isSuper && <Button onClick={() => setEditing('new')}><Plus aria-hidden /> Nuevo plan</Button>}
      </div>
      {plans.error ? <Alert title={errorMessage(plans.error, t)} /> : !plans.data ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.data.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{p.code}{!p.isPublic && ' · oculto'}</p>
                  </div>
                  {isSuper && (
                    <span className="flex gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}><Pencil aria-hidden /></Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(p)} aria-label={`Eliminar ${p.name}`}><Trash2 aria-hidden /></Button>
                    </span>
                  )}
                </div>
                <p className="text-2xl font-semibold tabular-nums">{formatMoney(p.priceMonthlyCents, p.currency)}<span className="text-sm font-normal text-muted-foreground">/mes</span></p>
                <p className="text-xs text-muted-foreground">{formatMoney(p.priceYearlyCents, p.currency)}/año · {p.trialDays} días de prueba · {p.activeSubscriptions} suscripciones</p>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {LIMITS.map(([k, label]) => (
                    <li key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{p.limits[k] ?? '∞'}</span></li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-1">
                  {FEATURES.filter(([k]) => p.features[k]).map(([k, label]) => <Badge key={k} tone="info">{label}</Badge>)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeletePlan plan={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: PlanDtoOutput | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const done = async () => { await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/platform/plans') }); onClose(); };
  const create = usePlansControllerCreate({ mutation: { onSuccess: done } });
  const update = usePlansControllerUpdate({ mutation: { onSuccess: done } });
  const m = plan ? update : create;
  const [f, setF] = useState({
    code: plan?.code ?? '', name: plan?.name ?? '', description: plan?.description ?? '',
    priceMonthly: plan ? String(plan.priceMonthlyCents / 100) : '', priceYearly: plan ? String(plan.priceYearlyCents / 100) : '',
    trialDays: String(plan?.trialDays ?? 14), isPublic: plan?.isPublic ?? true,
    limits: Object.fromEntries(LIMITS.map(([k]) => [k, plan?.limits[k] == null ? '' : String(plan.limits[k])])) as Record<string, string>,
    features: Object.fromEntries(FEATURES.map(([k]) => [k, Boolean(plan?.features[k])])) as Record<string, boolean>,
  });
  const fe = isApiError(m.error) ? m.error.fieldErrors() : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name, description: f.description || null,
      priceMonthlyCents: Math.round(Number(f.priceMonthly) * 100), priceYearlyCents: Math.round(Number(f.priceYearly) * 100),
      trialDays: Number(f.trialDays), isPublic: f.isPublic,
      limits: Object.fromEntries(LIMITS.map(([k]) => [k, f.limits[k] === '' ? null : Number(f.limits[k])])) as never,
      features: f.features as never,
    };
    if (plan) update.mutate({ id: plan.id, data: body });
    else create.mutate({ data: { ...body, code: f.code } });
  };

  return (
    <Dialog open onClose={onClose} title={plan ? `Editar ${plan.name}` : 'Nuevo plan'} className="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button type="submit" form="plan-form" loading={m.isPending}>{t('app.save')}</Button></>}>
      <form id="plan-form" onSubmit={submit} className="grid gap-4">
        {m.error && !Object.keys(fe).length ? <Alert title={errorMessage(m.error, t)} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {!plan && <Field label="Código" error={fe.code} hint="minúsculas, p. ej. pro-anual">{(p) => <Input {...p} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>}
          <Field label="Nombre" error={fe.name}>{(p) => <Input {...p} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Precio mensual (S/)" error={fe.priceMonthlyCents}>{(p) => <Input {...p} type="number" min={0} step="0.01" required value={f.priceMonthly} onChange={(e) => setF({ ...f, priceMonthly: e.target.value })} />}</Field>
          <Field label="Precio anual (S/)" error={fe.priceYearlyCents}>{(p) => <Input {...p} type="number" min={0} step="0.01" required value={f.priceYearly} onChange={(e) => setF({ ...f, priceYearly: e.target.value })} />}</Field>
          <Field label="Días de prueba">{(p) => <Input {...p} type="number" min={0} max={365} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} />}</Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Límites <span className="font-normal text-muted-foreground">(vacío = ilimitado)</span></legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {LIMITS.map(([k, label]) => <Field key={k} label={label} error={fe[`limits.${k}`]}>{(p) => <Input {...p} type="number" min={0} value={f.limits[k]} onChange={(e) => setF({ ...f, limits: { ...f.limits, [k]: e.target.value } })} />}</Field>)}
          </div>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Funciones incluidas</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FEATURES.map(([k, label]) => <Checkbox key={k} label={label} checked={f.features[k]} onChange={(e) => setF({ ...f, features: { ...f.features, [k]: e.target.checked } })} />)}
          </div>
        </fieldset>
        <Checkbox label="Visible en la web (se puede contratar)" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} />
      </form>
    </Dialog>
  );
}

function DeletePlan({ plan, onClose }: { plan: PlanDtoOutput; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const m = usePlansControllerRemove({ mutation: { onSuccess: async () => { await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/platform/plans') }); onClose(); } } });
  return (
    <Dialog open onClose={onClose} title={`Eliminar el plan ${plan.name}`} footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button variant="destructive" loading={m.isPending} onClick={() => m.mutate({ id: plan.id })}>Eliminar</Button></>}>
      {m.error ? <Alert title={errorMessage(m.error, t)} /> : null}
      <p className="text-sm">Deja de ofrecerse. Las {plan.activeSubscriptions} suscripciones que lo usan lo conservan.</p>
    </Dialog>
  );
}
