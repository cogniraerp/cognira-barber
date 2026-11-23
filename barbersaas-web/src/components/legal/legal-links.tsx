import { BookOpenText } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * Pie legal: Términos, Privacidad y el Libro de Reclamaciones (visible, como exige INDECOPI).
 * `bookHref`: el libro de quien vende (Cognira por defecto; en la página pública, el de la barbería).
 */
export function LegalLinks({ bookHref = '/libro-reclamaciones', className }: { bookHref?: string; className?: string }) {
  return (
    <nav aria-label="Enlaces legales" className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500', className)}>
      <Link to="/terminos" className="hover:underline">Términos y condiciones</Link>
      <Link to="/privacidad" className="hover:underline">Política de privacidad</Link>
      <Link to={bookHref} className="inline-flex items-center gap-1 font-medium text-slate-700 hover:underline">
        <BookOpenText className="size-3.5" aria-hidden /> Libro de Reclamaciones
      </Link>
    </nav>
  );
}
