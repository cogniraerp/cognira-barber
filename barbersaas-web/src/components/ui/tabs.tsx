import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TabItem<T extends string> = { id: T; label: string; icon?: ReactNode; badge?: ReactNode };

/**
 * Pestañas de la línea Cognira (subrayado azul en la activa). Accesibles: role tablist/tab/tabpanel,
 * flechas ← → para moverse, Inicio/Fin para ir a los extremos. Usar con <TabPanel> del mismo `idBase`.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  items: Array<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  idBase: string;
  className?: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = items.findIndex((t) => t.id === value);
    const next =
      e.key === 'ArrowRight' ? (i + 1) % items.length
        : e.key === 'ArrowLeft' ? (i - 1 + items.length) % items.length
          : e.key === 'Home' ? 0
            : e.key === 'End' ? items.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next]!.id);
    document.getElementById(`${idBase}-tab-${items[next]!.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn('-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0', className)}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            id={`${idBase}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${idBase}-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKey}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors [&_svg]:size-4',
              on ? 'border-marca-700 text-marca-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, id, children }: { idBase: string; id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className="focus-visible:outline-none">
      {children}
    </div>
  );
}

