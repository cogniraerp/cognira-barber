import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { delta, fmtPct } from './report-utils';

/**
 * Indicador con su variación frente al período anterior. La variación lleva flecha y signo
 * (no solo color); `lowerIsBetter` invierte el tono (p. ej. inasistencias).
 */
export function Kpi({ label, value, hint, current, previous, lowerIsBetter, hero, className }: {
  className?: string;
  label: string;
  value: string;
  hint?: string;
  current?: number;
  previous?: number;
  lowerIsBetter?: boolean;
  hero?: boolean;
}) {
  const d = current === undefined || previous === undefined ? undefined : delta(current, previous);
  const good = d !== null && d !== undefined && (lowerIsBetter ? d < 0 : d > 0);
  const bad = d !== null && d !== undefined && (lowerIsBetter ? d > 0 : d < 0);
  const Icon = !d ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn('grid min-w-0 content-start gap-1 rounded-2xl p-4 sm:p-5', className, hero ? 'bg-gradient-to-br from-marca-700 via-marca-900 to-noche text-white' : 'border border-slate-200/80 bg-white')}>
      <span className={cn('text-sm', hero ? 'text-celeste-100' : 'text-slate-500')}>{label}</span>
      <span className={cn('font-semibold tabular-nums', hero ? 'text-3xl' : 'text-xl text-slate-900 sm:text-2xl')}>{value}</span>
      {d !== undefined && (
        <span title="Comparado con el período anterior de igual duración" className={cn('flex items-center gap-1 text-xs font-medium', hero ? 'text-celeste-100' : good ? 'text-emerald-700' : bad ? 'text-red-700' : 'text-slate-500')}>
          <Icon className="size-3.5" aria-hidden />
          {d === null ? 'sin comparación' : `${d > 0 ? '+' : ''}${fmtPct(d * 100)} vs. anterior`}
        </span>
      )}
      {hint && <span className={cn('text-xs', hero ? 'text-celeste-100/80' : 'text-slate-500')}>{hint}</span>}
    </div>
  );
}

/** Barra fina 0–100 % (meter) para ocupación o participación; el número va al lado en texto. */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span className="flex items-center gap-2">
      <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <span className="block h-full rounded-full bg-marca-700" style={{ width: `${v}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{fmtPct(value)}</span>
    </span>
  );
}
