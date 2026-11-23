import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type MenuAction = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; hidden?: boolean };

/**
 * Menú "⋯" de acciones de una fila (como MenuAcciones de Cognira ERP). Se cierra con Esc,
 * clic afuera o al elegir; flechas ↑ ↓ para moverse.
 */
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  // Posición fija calculada al abrir: el menú se dibuja en <body> para que no lo recorte el
  // contenedor con scroll de la tabla. Se abre hacia arriba si no cabe abajo; se cierra al hacer scroll.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const open = pos !== null;
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = actions.filter((a) => !a.hidden);
  const setOpen = (v: boolean) => {
    if (!v) return setPos(null);
    const r = root.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    const below = window.innerHeight - r.bottom;
    setPos(below < items.length * 44 + 24 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setPos(null);
    };
    const dismiss = () => setPos(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);
  if (!items.length) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    }
  };
  return (
    <div ref={root} className="relative inline-block text-left" onKeyDown={onKey}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {pos && createPortal(
        <div ref={menu} id={id} role="menu" onKeyDown={onKey} style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, right: pos.right }}
          className="z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {items.map((a) => (
            <button key={a.label} type="button" role="menuitem" onClick={() => { setOpen(false); a.onSelect(); }}
              className={cn('flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm [&_svg]:size-4', a.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50')}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
