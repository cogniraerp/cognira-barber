import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { ReportOverviewDtoOutputByDayItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/utils';
import { bucketDays, dayLabel, monthLabel, type DayPoint } from './report-utils';

/**
 * Ingresos por día: una sola serie (sin leyenda, el título la nombra), columnas ≤ 24 px con
 * extremo redondeado de 4 px, grilla hairline, tooltip por columna y vista de tabla accesible.
 * Color: marca #1043c4 (contraste alto sobre la tarjeta blanca).
 */
const SERIES = '#1043c4';

export function RevenueChart({ data, actions }: { data: ReportOverviewDtoOutputByDayItem[]; actions?: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const { unit, rows: points } = bucketDays(data);
  const label = (d: string, long = false) => (unit === 'month' ? monthLabel(d) : dayLabel(d, long));
  const rows = points.map((d) => ({ ...d, label: label(d.date), long: label(d.date, true), soles: d.revenueCents / 100 }));
  const total = data.reduce((n, d) => n + d.revenueCents, 0);
  const best = points.reduce<DayPoint | null>((b, d) => (!b || d.revenueCents > b.revenueCents ? d : b), null);
  const what = unit === 'month' ? 'mes' : 'día';

  return (
    <figure className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-semibold text-slate-900">Ingresos por {what}</span>{' '}
          <span className="text-sm text-slate-500">
            · {formatMoney(total)} en total{best && best.revenueCents > 0 ? ` · mejor ${what}: ${label(best.date, true)} (${formatMoney(best.revenueCents)})` : ''}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? 'Ver gráfico' : 'Ver tabla'}</Button>
          {actions}
        </span>
      </figcaption>
      {asTable ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-slate-600">
              <tr><th scope="col" className="px-3 py-2 text-left font-medium">{unit === 'month' ? 'Mes' : 'Día'}</th><th scope="col" className="px-3 py-2 text-right font-medium">Ventas</th><th scope="col" className="px-3 py-2 text-right font-medium">Ingresos</th><th scope="col" className="px-3 py-2 text-right font-medium">Propinas</th></tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.date} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 capitalize">{d.long}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.salesCount}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatMoney(d.revenueCents)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{formatMoney(d.tipCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60" role="img" aria-label={`Ingresos por ${what}: ${formatMoney(total)} en total`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={56} tickFormatter={(v: number) => `S/ ${new Intl.NumberFormat('es-PE', { notation: 'compact' }).format(v)}`} />
              <Tooltip cursor={{ fill: '#f1f5f9' }} content={(p) => <Tip {...p} />} />
              <Bar dataKey="soles" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

function Tip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const p = payload?.[0];
  if (!active || !p) return null;
  const row = p.payload as DayPoint & { long: string };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <div className="capitalize text-slate-500">{row.long}</div>
      <div className="font-semibold tabular-nums text-slate-900">{formatMoney(row.revenueCents)}</div>
      <div className="text-xs text-slate-500">{row.salesCount} {row.salesCount === 1 ? 'venta' : 'ventas'}{row.tipCents ? ` · propinas ${formatMoney(row.tipCents)}` : ''}</div>
    </div>
  );
}
