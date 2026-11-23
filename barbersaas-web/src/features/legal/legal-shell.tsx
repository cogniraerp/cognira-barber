import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark, Wordmark } from '@/components/brand';
import { LegalLinks } from '@/components/legal/legal-links';

/** Marco simple para las páginas legales y el Libro de Reclamaciones. */
export function LegalShell({ title, subtitle, brand, bookHref, children }: {
  title: string;
  subtitle?: ReactNode;
  /** Cabecera propia (p. ej. el nombre de la barbería); por defecto, la marca Cognira. */
  brand?: ReactNode;
  bookHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          {brand ?? (
            <Link to="/" className="flex items-center gap-2" aria-label="Cognira Barber">
              <BrandMark className="size-7" />
              <Wordmark className="text-sm" />
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
        </div>
        {children}
      </main>
      <footer className="border-t bg-white py-6">
        <LegalLinks bookHref={bookHref} />
      </footer>
    </div>
  );
}
