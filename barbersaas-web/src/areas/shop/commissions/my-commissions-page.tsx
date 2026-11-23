import { useCommissionsControllerMe } from '@/api/generated/endpoints';
import { Alert, Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { METHOD, type Method } from '../cash/methods';
import { useShop } from '../shop-context';
import { EntriesTable } from './commissions-page';
import { PeriodPicker } from './period-picker';
import { configSummary, type Config } from './rule-utils';
import { usePeriod } from './use-period';

/** "Mis comisiones" del barbero: lo ganado en el período, lo pendiente y sus últimas liquidaciones. */
export function MyCommissionsPage() {
  const tz = useShop().barbershop.timezone;
  const period = usePeriod();
  const q = useCommissionsControllerMe({ from: period.range.fromIso, to: period.range.toIso });
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: tz });
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Mis comisiones" subtitle={q.data ? `Tu regla: ${configSummary(q.data.summary.config as Config)}` : undefined} />
      <PeriodPicker period={period} />
      {q.error ? <Alert title={errorMessage(q.error, i18n.t)} /> : !q.data ? <Skeleton className="h-72" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1 rounded-2xl bg-gradient-to-br from-marca-700 via-marca-900 to-noche p-5 text-white">
              <span className="text-sm text-celeste-100">Ganado en el período</span>
              <span className="text-3xl font-semibold tabular-nums">{formatMoney(q.data.summary.earnedCents)}</span>
              <span className="text-sm text-slate-300">{q.data.summary.servicesCount} servicio{q.data.summary.servicesCount === 1 ? '' : 's'} · propinas {formatMoney(q.data.summary.tipCents)}</span>
            </div>
            <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white p-5">
              <span className="text-sm text-slate-500">Por cobrar (pendiente)</span>
              <span className="text-2xl font-semibold text-slate-900 tabular-nums">{formatMoney(q.data.summary.pendingCents)}</span>
            </div>
            <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white p-5">
              <span className="text-sm text-slate-500">Última liquidación</span>
              {q.data.payouts[0] ? (
                <>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">{formatMoney(q.data.payouts[0].totalCents)}</span>
                  <span className="text-sm text-slate-500">{fmt.format(new Date(q.data.payouts[0].createdAt))} · {METHOD[q.data.payouts[0].method as Method].label}</span>
                </>
              ) : <span className="text-slate-400">Aún no hay</span>}
            </div>
          </div>
          <EntriesTable items={q.data.entries} />
        </>
      )}
    </div>
  );
}
