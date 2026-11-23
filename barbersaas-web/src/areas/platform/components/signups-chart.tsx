import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Button } from '@/components/ui/button';

/**
 * Altas por día (una sola serie → sin leyenda; el título la nombra).
 * Marcas según la guía: columnas ≤ 24 px, extremo redondeado 4 px y base recta, grilla hairline sólida,
 * tooltip al pasar el mouse y vista de tabla como alternativa accesible.
 * Color validado (series-1 #2a78d6, ≥ 3:1 sobre la tarjeta blanca).
 */
const SERIES = '#2a78d6';

export function SignupsChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const [asTable, setAsTable] = useState(false);
  const rows = data.map((d) => ({ ...d, label: new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T00:00:00Z`)) }));
  const total = data.reduce((n, d) => n + d.count, 0);

  return (
    <figure className="grid gap-3">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span>
          <span className="font-semibold">Altas de barberías</span>{' '}
          <span className="text-sm text-muted-foreground">· últimos 30 días · {total} en total</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Ver gráfico' : 'Ver tabla'}
        </Button>
      </figcaption>
      {asTable ? (
        <div className="max-h-64 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr><th scope="col" className="border-b px-3 py-2 text-left font-medium">Día</th><th scope="col" className="border-b px-3 py-2 text-right font-medium">Altas</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.date}><td className="border-b px-3 py-1.5">{r.label}</td><td className="border-b px-3 py-1.5 text-right tabular-nums">{r.count}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-56" role="img" aria-label={`Altas por día en los últimos 30 días: ${total} en total`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} width={44} />
              <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={(p) => <Tip {...p} />} />
              <Bar dataKey="count" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
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
  const row = p.payload as { label: string; count: number };
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-md">
      <div className="text-muted-foreground">{row.label}</div>
      <div className="font-semibold tabular-nums">{row.count} {row.count === 1 ? 'alta' : 'altas'}</div>
    </div>
  );
}
