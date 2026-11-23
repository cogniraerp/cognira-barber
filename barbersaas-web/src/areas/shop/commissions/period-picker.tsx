import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/form';
import { PERIOD_LABEL } from '@/lib/period';
import type { usePeriod } from './use-period';

export function PeriodPicker({ period }: { period: ReturnType<typeof usePeriod> }) {
  const { L, key, range } = period;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Período" className="w-auto min-w-44" value={key} onChange={(e) => L.set({ periodo: e.target.value === 'semana' ? null : e.target.value, desde: null, hasta: null })}>
        {Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      {key === 'rango' ? (
        <>
          <Input type="date" aria-label="Desde" className="w-auto" value={range.from} onChange={(e) => L.set({ desde: e.target.value })} />
          <span className="text-sm text-slate-400">a</span>
          <Input type="date" aria-label="Hasta" className="w-auto" value={range.toInclusive} onChange={(e) => L.set({ hasta: e.target.value })} />
        </>
      ) : (
        <span className="text-sm text-slate-500 tabular-nums">{fmt(range.from)} – {fmt(range.toInclusive)}</span>
      )}
    </div>
  );
}

const fmt = (d: string) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
