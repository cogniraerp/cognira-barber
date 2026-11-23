import { cn } from '@/lib/utils';

/** Clases de un ítem del menú lateral navy (activo: fondo translúcido + barra celeste). */
export function sideItem(active: boolean) {
  return cn(
    'relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
    active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
  );
}
