import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { HTMLAttributes, InputHTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Select } from './form';
import { PAGE_SIZES, pageButtons } from './pagination-utils';

/**
 * Listados con el mismo diseño en todo el panel (línea Cognira):
 *   <PageHeader> título + acciones · <FilterBar> búsqueda y filtros en una fila ·
 *   <Table> (o tarjetas en móvil) · <Pagination> "Mostrando 1–20 de 87", filas por página y páginas.
 */

export function PageHeader({ title, subtitle, actions, before }: { title: string; subtitle?: ReactNode; actions?: ReactNode; before?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {before}
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Barra de filtros: la búsqueda ocupa el espacio libre y los selects van a su lado. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>select]:sm:w-auto [&>select]:sm:min-w-44', className)}>{children}</div>;
}

export function SearchField({ label = 'Buscar', className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={cn('relative block min-w-0 flex-1', className)}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-base text-slate-800 placeholder:text-slate-400 focus:border-marca-600 focus:ring-2 focus:ring-marca-100 focus:outline-none sm:text-sm"
        {...p}
      />
    </label>
  );
}

/** Contenedor con scroll horizontal propio: la página nunca se desborda. */
export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <div className="relative overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <table className={cn('min-w-full divide-y divide-slate-200 text-sm [&_tbody]:divide-y [&_tbody]:divide-slate-100 [&_thead]:bg-slate-50/80 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-slate-50/70', className)} {...p} />
  </div>
);
export const Th = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn('px-4 py-3 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase', className)} {...p} />
);
export const Td = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-4 py-3 align-middle text-slate-700', className)} {...p} />;

/** Tarjeta de un registro en móvil (la tabla se oculta por debajo de `md`). */
export const MobileCard = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)} {...p} />
);

const pagBtn =
  'inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 tabular-nums transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  sizes = PAGE_SIZES,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  /** Si se pasa, se muestra el selector "Filas". */
  onPageSize?: (n: number) => void;
  sizes?: number[];
}) {
  if (total <= 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const options = [...new Set([...sizes, pageSize])].sort((a, b) => a - b);
  return (
    <nav aria-label="Paginación" className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center justify-between gap-3 text-slate-500 sm:justify-start">
        <span>
          Mostrando <strong className="font-medium text-slate-700 tabular-nums">{from}–{to}</strong> de{' '}
          <strong className="font-medium text-slate-700 tabular-nums">{total.toLocaleString('es-PE')}</strong>
        </span>
        {onPageSize && (
          <label className="flex items-center gap-2">
            <span className="hidden sm:inline">Filas</span>
            <Select aria-label="Filas por página" className="h-9 w-auto py-0 pr-8 text-sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </label>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 sm:justify-end">
        <button type="button" className={pagBtn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="size-4" aria-hidden /><span className="sm:hidden">Anterior</span>
        </button>
        <span className="hidden items-center gap-1 sm:flex">
          {pageButtons(page, pages).map((b, i) =>
            b === '…' ? (
              <span key={`e${i}`} className="w-8 text-center text-slate-400" aria-hidden>…</span>
            ) : (
              <button key={b} type="button" onClick={() => onPage(b)} aria-label={`Página ${b}`} aria-current={b === page ? 'page' : undefined}
                className={cn(pagBtn, 'min-w-9', b === page && 'border-marca-700 bg-marca-700 text-white hover:bg-marca-700')}>
                {b}
              </button>
            ),
          )}
        </span>
        <span className="px-2 text-slate-500 tabular-nums sm:hidden">{page} / {pages}</span>
        <button type="button" className={pagBtn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
          <span className="sm:hidden">Siguiente</span><ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
