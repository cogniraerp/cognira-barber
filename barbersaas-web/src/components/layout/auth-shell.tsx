import { CalendarCheck, MessageCircle, Scissors } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark, Wordmark } from '@/components/brand';
import { LegalLinks } from '@/components/legal/legal-links';
import { LanguageToggle } from './language-toggle';

const POINTS = [
  { icon: CalendarCheck, title: 'Reservas online 24/7', text: 'Tu página con tu marca: el cliente elige servicio, barbero y hora.' },
  { icon: MessageCircle, title: 'Recordatorios por WhatsApp', text: 'Confirmación y recordatorio automáticos: menos inasistencias.' },
  { icon: Scissors, title: 'Agenda y "Mi día"', text: 'Cada barbero ve sus citas en el celular; tú, toda la barbería.' },
];

/**
 * Login y registro con el diseño de la línea Cognira: panel navy con degradado a la izquierda
 * (solo escritorio) y el formulario a la derecha. En móvil, solo el formulario.
 */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-white lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-noche p-12 text-white lg:flex lg:flex-col" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(31,195,238,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(139,123,244,0.25),transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-11" />
          <span className="grid">
            <Wordmark tone="light" />
            <span className="text-xs text-slate-400">Gestión y reservas para barberías</span>
          </span>
        </div>
        <h2 className="relative mt-16 max-w-md text-4xl leading-tight font-semibold tracking-tight">
          Tu barbería llena, <span className="text-celeste-300">sin vivir pegado al WhatsApp.</span>
        </h2>
        <ul className="relative mt-12 grid max-w-md gap-6">
          {POINTS.map((p) => (
            <li key={p.title} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 text-celeste-300"><p.icon className="size-4" /></span>
              <span>
                <span className="block font-medium">{p.title}</span>
                <span className="text-sm text-slate-400">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="relative mt-auto text-xs text-slate-500">© {new Date().getFullYear()} Cognira · Datos aislados por barbería</p>
      </section>

      <section className="grid grid-rows-[auto_1fr_auto] p-4 sm:p-8">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2 lg:invisible">
            <BrandMark className="size-8" />
            <Wordmark className="text-sm" />
          </span>
          <LanguageToggle />
        </header>
        <div className="grid place-items-center py-8">
          <div className="w-full max-w-sm">
            <div className="mb-6 grid gap-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
              {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
            </div>
            {children}
            {footer && <div className="mt-6 text-sm text-slate-500">{footer}</div>}
          </div>
        </div>
        <LegalLinks className="pb-2" />
      </section>
    </main>
  );
}
