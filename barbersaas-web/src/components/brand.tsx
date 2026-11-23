import { cn } from '@/lib/utils';

/** Símbolo de Cognira Barber (la "C" de la línea Cognira con la tijera). */
export function BrandMark({ className, light = false }: { className?: string; light?: boolean }) {
  return <img src={light ? '/brand/cognira-barber-icono-blanco.svg' : '/brand/cognira-barber-icono.svg'} alt="" className={cn('size-9 shrink-0', className)} />;
}

/** "COGNIRA BARBER" como en Cognira ERP / Cognira Dental. tone: 'dark' (fondo claro) o 'light' (fondo navy). */
export function Wordmark({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  return (
    <span className={cn('font-sans font-semibold tracking-[0.14em] whitespace-nowrap', tone === 'dark' ? 'text-slate-900' : 'text-white', className)}>
      COGNIRA <span className={cn('tracking-[0.2em]', tone === 'dark' ? 'text-marca-600' : 'text-celeste-400')}>BARBER</span>
    </span>
  );
}

/** Iniciales en círculo con el degradado celeste → azul de la línea. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const text = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-celeste-400 to-marca-700 text-sm font-semibold text-white', className)} aria-hidden>
      {text}
    </span>
  );
}

