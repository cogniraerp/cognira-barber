import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useShopPlanControllerCancel, useShopPlanControllerChange, useShopPlanControllerPlans } from '@/api/generated/endpoints';
import type { PlanOptionsDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
import { Section } from './shared';

type Plan = PlanOptionsDto['plans'][number];
const FEATURE: Record<string, string> = {
  onlinePayments: 'Pagos en línea y adelantos',
  advancedReports: 'Reportes avanzados',
  loyalty: 'Fidelización',
  multiLocation: 'Varias sedes',
  customDomain: 'Dominio propio',
  removeBranding: 'Sin marca Cognira',
  api: 'API',
};
const LIMIT: Record<'staff' | 'locations' | 'services', [string, string]> = {
  staff: ['barbero', 'barberos'],
  locations: ['sede', 'sedes'],
  services: ['servicio', 'servicios'],
};
const fmtDate = (d: string) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
const limitText = (k: keyof typeof LIMIT, v: number | null) => (v === null ? `${LIMIT[k][1][0]!.toUpperCase()}${LIMIT[k][1].slice(1)} ilimitados` : `Hasta ${v} ${v === 1 ? LIMIT[k][0] : LIMIT[k][1]}`);

/**
 * Cambiar de plan (solo el dueño): subir se aplica ya con factura por la diferencia; bajar o
 * cambiar mensual/anual queda programado para el fin del periodo pagado.
 */
export function PlanPicker({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const q = useShopPlanControllerPlans();
  const [interval, setInterval] = useState<'month' | 'year' | null>(null);
  const [confirm, setConfirm] = useState<Plan | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/v1/shop') });
  const change = useShopPlanControllerChange({
    mutation: {
      onSuccess: async (r) => {
        await refresh();
        setConfirm(null);
        toast.success(
          r.result === 'scheduled'
            ? 'Cambio programado para el fin de tu periodo'
            : r.invoice
              ? `Plan cambiado. Emitimos una factura de ${formatMoney(r.invoice.amountCents)} por la diferencia: págala abajo.`
              : 'Plan cambiado',
        );
      },
    },
  });
  const cancel = useShopPlanControllerCancel({ mutation: { onSuccess: async () => { await refresh(); toast.success('Cambio programado cancelado'); } } });
  if (q.error) return <Alert title={errorMessage(q.error, i18n.t)} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const d = q.data;
  const iv = interval ?? d.interval;
  const ivChanges = iv !== d.interval;

  return (
    <Section title="Cambiar de plan" description="Subir de plan se aplica al instante; bajar o cambiar entre mensual y anual, al terminar tu periodo pagado."
      actions={
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Facturación">
          {(['month', 'year'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={iv === v} onClick={() => setInterval(v)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium', iv === v ? 'bg-marca-700 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {v === 'month' ? 'Mensual' : 'Anual'}
            </button>
          ))}
        </div>
      }>
      {d.pending && (
        <Alert tone="info" title={`Cambio programado: ${d.pending.planName} · ${d.pending.interval === 'year' ? 'anual' : 'mensual'} desde el ${fmtDate(d.pending.effectiveAt)}`}>
          {canManage && <Button size="sm" variant="ghost" className="mt-1 h-auto px-0" loading={cancel.isPending} onClick={() => cancel.mutate()}><X aria-hidden /> Cancelar el cambio</Button>}
        </Alert>
      )}
      {!d.canChange && <Alert title="Paga tus facturas pendientes para poder cambiar de plan" />}
      <ul className="grid gap-3 md:grid-cols-3">
        {d.plans.map((p) => {
          const current = p.code === d.currentPlanCode;
          const price = iv === 'year' ? p.priceYearlyCents : p.priceMonthlyCents;
          const blocked = p.blockers.length > 0;
          const isCurrentChoice = current && !ivChanges;
          return (
            <li key={p.code} className={cn('grid content-start gap-3 rounded-2xl border p-4', current ? 'border-marca-400 bg-marca-50/40 ring-1 ring-marca-400' : 'border-slate-200 bg-white')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold text-slate-900">{p.name}</span>
                {current && <Badge tone="info"><CircleCheck className="mr-1 size-3" aria-hidden />Tu plan</Badge>}
              </div>
              <p><span className="text-2xl font-semibold tabular-nums">{formatMoney(price, p.currency)}</span> <span className="text-sm text-slate-500">/ {iv === 'year' ? 'año' : 'mes'}</span></p>
              {iv === 'year' && p.priceMonthlyCents * 12 > p.priceYearlyCents && (
                <p className="-mt-2 text-sm font-medium text-emerald-700">Ahorras {formatMoney(p.priceMonthlyCents * 12 - p.priceYearlyCents, p.currency)} al año</p>
              )}
              <ul className="grid gap-1 text-sm text-slate-700">
                {(['staff', 'locations', 'services'] as const).map((k) => <li key={k} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />{limitText(k, p.limits[k])}</li>)}
                {Object.entries(p.features).filter(([, on]) => on).map(([f]) => FEATURE[f] && <li key={f} className="flex gap-1.5"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />{FEATURE[f]}</li>)}
              </ul>
              {blocked && !current && (
                <p className="flex gap-1.5 text-xs text-amber-800"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Tienes {p.blockers.map((b) => `${b.current} ${LIMIT[b.key][1]} (máx. ${b.max})`).join(' y ')}.</p>
              )}
              {canManage && !isCurrentChoice && (
                <Button variant={p.change === 'now' && !ivChanges ? 'default' : 'outline'} disabled={!d.canChange || (blocked && !current)} onClick={() => setConfirm(p)}>
                  {current ? `Pasar a ${iv === 'year' ? 'anual' : 'mensual'}` : p.change === 'now' ? `Cambiar a ${p.name}` : `Bajar a ${p.name}`}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {confirm && (() => {
        const now = confirm.change === 'now' && confirm.code !== d.currentPlanCode;
        return (
          <Dialog open onClose={() => setConfirm(null)} title={`¿Cambiar a ${confirm.name}${ivChanges ? ` (${iv === 'year' ? 'anual' : 'mensual'})` : ''}?`}
            footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button><Button loading={change.isPending} onClick={() => change.mutate({ data: { planCode: confirm.code, interval: iv } })}>Confirmar</Button></>}>
            <div className="grid gap-3 text-sm">
              {change.error ? <Alert title={errorMessage(change.error, i18n.t)} /> : null}
              {d.status === 'trialing' ? (
                <p>Estás en periodo de prueba: el cambio es inmediato y no se cobra nada ahora.</p>
              ) : now ? (
                <p>Se aplica <strong>ahora mismo</strong>.{confirm.prorationCents > 0 ? <> Emitiremos una factura de <strong>{formatMoney(confirm.prorationCents, confirm.currency)}</strong> por la diferencia de los días que quedan de tu periodo.</> : ' No hay diferencia que cobrar.'}{ivChanges && ' El cambio a ' + (iv === 'year' ? 'anual' : 'mensual') + ' se aplica al terminar tu periodo.'}</p>
              ) : (
                <p className="flex gap-2"><CalendarClock className="mt-0.5 size-4 shrink-0 text-marca-700" aria-hidden />Se aplica al <strong>terminar tu periodo pagado</strong>. Hasta entonces sigues con todo lo de tu plan actual; tu próxima factura ya saldrá con el precio nuevo.</p>
              )}
            </div>
          </Dialog>
        );
      })()}
    </Section>
  );
}
