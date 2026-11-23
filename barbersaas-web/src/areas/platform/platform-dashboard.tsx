import { AlertTriangle, CheckCircle2, Clock, PauseCircle, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { useDashboardControllerGet } from '@/api/generated/endpoints';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { SignupsChart } from './components/signups-chart';

const pct = (v: number) => `${(v * 100).toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`;
const compact = (n: number) => new Intl.NumberFormat('es-PE', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);

/** Panel global: una cifra protagonista (MRR), estado de la cartera, altas y ranking. */
export function PlatformDashboard() {
  const { t } = useTranslation();
  const role = useAuth((s) => s.user?.platformRole);
  const dash = useDashboardControllerGet({ query: { enabled: role === 'superadmin', refetchInterval: 120_000 } });
  if (role !== 'superadmin') return <Navigate to="barberias" replace />;
  if (dash.error) return <div className="p-6"><Alert title={errorMessage(dash.error, t)} /></div>;
  const d = dash.data;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{t('nav.dashboard')}</h1>

      {!d ? (
        <div className="grid gap-4"><Skeleton className="h-36" /><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
      ) : (
        <>
          <section aria-label="Ingresos" className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardContent className="grid gap-1 p-6">
                <span className="text-sm text-muted-foreground">Ingreso recurrente mensual (MRR)</span>
                <span className="text-5xl font-semibold tracking-tight tabular-nums">
                  {d.mrr.length ? d.mrr.map((m) => formatMoney(m.amountCents, m.currency)).join(' + ') : formatMoney(0)}
                </span>
                <span className="text-sm text-muted-foreground">
                  ARR {d.arr.length ? d.arr.map((m) => formatMoney(m.amountCents, m.currency)).join(' + ') : formatMoney(0)}
                </span>
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Churn (30 días)" value={pct(d.churn30d.rate)} hint={`${d.churn30d.canceled} cancelaciones`} />
              <Tile label="Conversión de prueba" value={pct(d.trialConversion90d.rate)} hint={`${d.trialConversion90d.converted} de ${d.trialConversion90d.started} (90 días)`} />
              <Tile label="Citas (30 días)" value={compact(d.appointments30d)} />
              <Tile label="WhatsApp este mes" value={compact(d.whatsappThisMonth)} />
            </div>
          </section>

          <section aria-labelledby="subs" className="grid gap-2">
            <h2 id="subs" className="text-sm font-medium text-muted-foreground">Suscripciones</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatusTile icon={<CheckCircle2 className="text-green-700" />} label="Activas" value={d.subscriptions.active} />
              <StatusTile icon={<Clock className="text-blue-700" />} label="En prueba" value={d.subscriptions.trialing} />
              <StatusTile icon={<AlertTriangle className="text-amber-700" />} label="Morosas" value={d.subscriptions.past_due} />
              <StatusTile icon={<PauseCircle className="text-red-700" />} label="Suspendidas" value={d.subscriptions.suspended} />
              <StatusTile icon={<XCircle className="text-muted-foreground" />} label="Canceladas" value={d.subscriptions.canceled} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card><CardContent className="p-5"><SignupsChart data={d.signups30d} /></CardContent></Card>
            <Card>
              <CardHeader><CardTitle>Barberías más activas</CardTitle><p className="text-sm text-muted-foreground">Citas creadas en los últimos 30 días</p></CardHeader>
              <CardContent>
                {d.topBarbershops.length === 0 ? <p className="text-sm text-muted-foreground">Sin actividad todavía.</p> : <TopList items={d.topBarbershops} />}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="grid gap-0.5 p-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}

function StatusTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 [&_svg]:size-5">
        {icon}
        <span className="grid">
          <span className="text-xl font-semibold tabular-nums">{value}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </span>
      </CardContent>
    </Card>
  );
}

/** Ranking: barras finas de una sola serie con el valor en la punta (no dentro de la barra). */
function TopList({ items }: { items: Array<{ id: string; slug: string; name: string; appointments30d: number }> }) {
  const max = Math.max(...items.map((i) => i.appointments30d), 1);
  return (
    <ol className="grid gap-3">
      {items.map((b) => (
        <li key={b.id}>
          <Link to={`barberias/${b.id}`} className="grid gap-1 rounded-md hover:bg-muted/50 focus-visible:bg-muted/50">
            <span className="flex justify-between gap-2 text-sm">
              <span className="truncate font-medium">{b.name}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${(b.appointments30d / max) * 85}%` }} aria-hidden />
              <span className="text-sm tabular-nums text-muted-foreground">{b.appointments30d.toLocaleString('es-PE')}</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
