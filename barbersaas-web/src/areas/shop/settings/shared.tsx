import { ImageUp, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { uploadsControllerUpload } from '@/api/generated/endpoints';
import type { UploadsControllerUploadKind } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DAY_NAMES, DAY_ORDER, failed, type Block, type Day } from './shared-utils';

export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Sube una imagen (PNG/JPG/WEBP) y devuelve su URL pública. La API valida el tipo real y la cuota. */
export function ImageUpload({
  kind,
  value,
  onChange,
  label,
  shape = 'square',
}: {
  kind: UploadsControllerUploadKind;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  label: string;
  shape?: 'square' | 'wide';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadsControllerUpload({ file }, { kind });
      onChange(r.url);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn('grid place-items-center overflow-hidden rounded-lg border border-dashed bg-muted/40 hover:bg-muted', shape === 'wide' ? 'h-20 w-40' : 'size-20')}
          aria-label={value ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`}
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : value ? <img src={value} alt="" className="size-full object-cover" /> : <ImageUp className="size-5 text-muted-foreground" aria-hidden />}
        </button>
        {value && <Button variant="ghost" size="sm" onClick={() => onChange(null)}><X aria-hidden /> Quitar</Button>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}

// ───────────────────── Editor de horario semanal ─────────────────────
export function WeekEditor({
  days,
  onChange,
  withBreaks,
  errors = {},
  disabledBlocks,
}: {
  days: Day[];
  onChange: (d: Day[]) => void;
  withBreaks?: boolean;
  /** error por día de la semana (ver weekErrors) */
  errors?: Record<number, string>;
  disabledBlocks?: boolean;
}) {
  const byDow = new Map(days.map((d) => [d.dayOfWeek, d]));
  const update = (dow: number, patch: Partial<Day>) => {
    const current = byDow.get(dow) ?? { dayOfWeek: dow, blocks: [], breaks: [] };
    const next = DAY_ORDER.map((d) => (d === dow ? { ...current, ...patch } : byDow.get(d) ?? { dayOfWeek: d, blocks: [], breaks: [] }));
    onChange(next);
  };
  return (
    <div className="grid divide-y rounded-lg border">
      {DAY_ORDER.map((dow) => {
        const d = byDow.get(dow) ?? { dayOfWeek: dow, blocks: [], breaks: [] };
        const open = d.blocks.length > 0;
        const err = errors[dow];
        return (
          <div key={dow} className="grid gap-2 p-3 sm:grid-cols-[8rem_1fr]">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4"
                checked={disabledBlocks ? true : open}
                disabled={disabledBlocks}
                onChange={(e) => update(dow, { blocks: e.target.checked ? [{ start: '09:00', end: '19:00' }] : [], breaks: [] })}
              />
              {DAY_NAMES[dow]}
            </label>
            <div className="grid gap-2">
              {!disabledBlocks && (open ? <BlockList label="Horario" blocks={d.blocks} onChange={(blocks) => update(dow, { blocks })} /> : <span className="text-sm text-muted-foreground">Cerrado</span>)}
              {withBreaks && (open || disabledBlocks) && (
                <BlockList label="Descansos" blocks={d.breaks ?? []} onChange={(breaks) => update(dow, { breaks })} addLabel="Agregar descanso" defaultBlock={{ start: '13:00', end: '14:00' }} allowEmpty />
              )}
              {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlockList({ label, blocks, onChange, addLabel = 'Agregar bloque', defaultBlock, allowEmpty }: { label: string; blocks: Block[]; onChange: (b: Block[]) => void; addLabel?: string; defaultBlock?: Block; allowEmpty?: boolean }) {
  const add = () => {
    const last = blocks.at(-1);
    onChange([...blocks, defaultBlock ?? { start: last ? last.end : '09:00', end: last ? '21:00' : '13:00' }]);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only">{label}</span>
      {blocks.map((b, i) => (
        <span key={i} className="flex items-center gap-1 rounded-md border bg-background p-1">
          <Input type="time" aria-label={`${label} ${i + 1} inicio`} className="h-8 w-[8rem] px-2" value={b.start} onChange={(e) => onChange(blocks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span aria-hidden>–</span>
          <Input type="time" aria-label={`${label} ${i + 1} fin`} className="h-8 w-[8rem] px-2" value={b.end} onChange={(e) => onChange(blocks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          {(allowEmpty || blocks.length > 1) && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label={`Quitar ${label.toLowerCase()} ${i + 1}`}>
              <Trash2 aria-hidden />
            </Button>
          )}
        </span>
      ))}
      {blocks.length < 4 && (
        <Button variant="ghost" size="sm" onClick={add}>
          <Plus aria-hidden /> {addLabel}
        </Button>
      )}
    </div>
  );
}

