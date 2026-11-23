import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { usePublicBookingControllerShopAvailability } from '@/api/generated/endpoints';
import type { AvailabilityDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { formatTime, localDate, toWall } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { addDaysStr, partOfDay } from './public-utils';

const WINDOW = 14;
export type Slot = { start: string; staffIds?: string[] };

/**
 * Elegir día y hora. Pide 14 días de disponibilidad a la vez: la tira de días muestra cuáles
 * tienen horarios libres (los demás quedan deshabilitados) y debajo van las horas del día.
 */
export function SlotPicker({
  slug,
  serviceIds,
  staffId,
  tz,
  maxAdvanceDays,
  value,
  onChange,
}: {
  slug: string;
  serviceIds: string[];
  staffId: string | null;
  tz: string;
  maxAdvanceDays: number;
  value: Slot | null;
  /** Con la hora llegan los precios/duraciones por barbero para esos servicios. */
  onChange: (s: Slot, quotes: AvailabilityDto['staff']) => void;
}) {
  const today = localDate(new Date(), tz);
  const last = addDaysStr(today, maxAdvanceDays);
  const [from, setFrom] = useState(today);
  const to = addDaysStr(from, WINDOW - 1) > last ? last : addDaysStr(from, WINDOW - 1);
  const q = usePublicBookingControllerShopAvailability(
    slug,
    { serviceIds, from, to, ...(staffId ? { staffId } : {}) },
    { query: { staleTime: 30_000 } },
  );
  const [picked, setPicked] = useState<string | null>(value ? localDate(new Date(value.start), tz) : null);
  const days = q.data?.days ?? [];
  const byDate = new Map(days.map((d) => [d.date, d.slots]));
  const firstFree = days.find((d) => d.slots.length)?.date ?? null;
  const date = picked && byDate.get(picked)?.length ? picked : firstFree;
  const slots = (date && byDate.get(date)) || [];

  const dates = Array.from({ length: WINDOW }, (_, i) => addDaysStr(from, i)).filter((d) => d <= last);
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    const g = partOfDay(toWall(s.start, tz).getHours());
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('es-PE', { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium first-letter:uppercase">{fmt(date ?? from, { month: 'long', year: 'numeric' })}</p>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="size-9" aria-label="Días anteriores" disabled={from <= today} onClick={() => setFrom(addDaysStr(from, -WINDOW) < today ? today : addDaysStr(from, -WINDOW))}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon" className="size-9" aria-label="Días siguientes" disabled={to >= last} onClick={() => setFrom(addDaysStr(to, 1))}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Día">
        {dates.map((d) => {
          const n = byDate.get(d)?.length ?? 0;
          const selected = d === date;
          return (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={selected}
              data-date={d}
              disabled={!q.data || n === 0}
              onClick={() => setPicked(d)}
              className={cn(
                'grid w-16 shrink-0 snap-start place-items-center gap-0.5 rounded-xl border px-1 py-2 text-sm transition-colors',
                selected ? 'border-brand bg-brand text-brand-foreground' : 'bg-card hover:border-foreground/40',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <span className="text-xs capitalize">{d === today ? 'Hoy' : fmt(d, { weekday: 'short' }).replace('.', '')}</span>
              <span className="text-lg font-semibold tabular-nums">{Number(d.slice(8))}</span>
              <span className={cn('text-[0.6875rem]', selected ? 'opacity-90' : 'text-muted-foreground')}>{q.data ? (n ? `${n} libres` : '—') : '…'}</span>
            </button>
          );
        })}
      </div>

      {q.isPending ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : q.error ? (
        <p className="text-sm text-destructive">No pudimos cargar los horarios. Revisa tu conexión e inténtalo de nuevo.</p>
      ) : !date ? (
        <div className="grid justify-items-start gap-2 rounded-xl border border-dashed p-4 text-sm">
          <p>No hay horarios libres en estos días.</p>
          {to < last && <Button variant="outline" size="sm" onClick={() => setFrom(addDaysStr(to, 1))}>Ver los días siguientes</Button>}
        </div>
      ) : (
        <div className="grid gap-4">
          {[...groups.entries()].map(([g, list]) => (
            <fieldset key={g} className="grid gap-2">
              <legend className="mb-2 text-sm font-medium text-muted-foreground">{g}</legend>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {list.map((s) => {
                  const on = value?.start === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      aria-pressed={on}
                      data-start={s.start}
                      onClick={() => onChange(s, q.data?.staff ?? [])}
                      className={cn(
                        'h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                        on ? 'border-brand bg-brand text-brand-foreground' : 'bg-card hover:border-foreground/40',
                      )}
                    >
                      {formatTime(s.start, tz, 'es-PE')}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}
