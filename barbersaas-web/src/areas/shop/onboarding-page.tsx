import { Check, Copy, ExternalLink, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOnboardingControllerActivate, useOnboardingControllerGet, useOnboardingControllerUpdate } from '@/api/generated/endpoints';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Alert, Skeleton } from '@/components/ui/misc';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { shopPageUrl } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { useShop } from './shop-context';
import { BrandingForm } from './settings/branding-form';
import { HoursForm } from './settings/hours-form';
import { ProfileForm } from './settings/profile-form';
import { ServicesManager } from './settings/services-page';
import { failed, saved, useRefreshShop } from './settings/shared-utils';
import { StaffManager } from './settings/staff-page';
import { Connection } from './settings/whatsapp-page';

type StepKey = 'profile' | 'branding' | 'hours' | 'services' | 'staff' | 'whatsapp' | 'share';
const STEPS: Array<{ key: StepKey; title: string; hint: string }> = [
  { key: 'profile', title: 'Datos de la barbería', hint: 'Teléfono y dirección para que tus clientes te encuentren.' },
  { key: 'branding', title: 'Logo y colores', hint: 'Tu página de reservas con tu identidad.' },
  { key: 'hours', title: 'Horario', hint: 'Cuándo atiendes. Puedes partir el día en bloques.' },
  { key: 'services', title: 'Servicios', hint: 'Qué ofreces, cuánto dura y cuánto cuesta.' },
  { key: 'staff', title: 'Barberos', hint: 'Quiénes atienden. Agrégate si trabajas solo.' },
  { key: 'whatsapp', title: 'WhatsApp', hint: 'Confirmaciones y recordatorios automáticos.' },
  { key: 'share', title: 'Compartir tu enlace', hint: 'Publica tu barbería y empieza a recibir reservas.' },
];
/** Pasos que se pueden "omitir" (los demás se completan solos al cargar los datos). */
const SKIPPABLE: StepKey[] = ['branding', 'whatsapp', 'share'];

/** Asistente de configuración inicial: 7 pasos con barra de progreso; se puede dejar para después. */
export function OnboardingPage() {
  const shop = useShop();
  const navigate = useNavigate();
  const refresh = useRefreshShop();
  const ob = useOnboardingControllerGet({ query: {} });
  const [current, setCurrent] = useState<StepKey | null>(null);
  const update = useOnboardingControllerUpdate({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const activate = useOnboardingControllerActivate({ mutation: { onSuccess: async () => { await refresh(); saved('¡Tu barbería ya recibe reservas!'); } } });

  if (!ob.data) return <div className="mx-auto max-w-5xl p-6"><Skeleton className="h-96" /></div>;
  const done = new Map(ob.data.steps.map((s) => [s.key, s.done]));
  const firstPending = STEPS.find((s) => !done.get(s.key))?.key ?? 'share';
  const step = current ?? firstPending;
  const idx = STEPS.findIndex((s) => s.key === step);
  const go = (k: StepKey | undefined) => k && setCurrent(k);
  const next = () => go(STEPS[idx + 1]?.key);
  const skip = () => {
    if (SKIPPABLE.includes(step) && !done.get(step)) update.mutate({ data: { completeStep: step as 'branding' } });
    next();
  };
  const later = () => update.mutate({ data: { dismissed: true } }, { onSuccess: () => navigate('..') });
  const url = shopPageUrl(shop.barbershop.slug, { rootDomain: env.rootDomain, subdomains: env.publicSubdomains });

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[16rem_1fr]">
      <aside className="grid content-start gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Configura tu barbería</h1>
          <p className="text-sm text-muted-foreground">{ob.data.progress}% completado</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Progreso" aria-valuenow={ob.data.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-brand transition-all" style={{ width: `${ob.data.progress}%` }} />
          </div>
        </div>
        <ol className="grid gap-1">
          {STEPS.map((s, i) => {
            const isDone = done.get(s.key);
            const required = ob.data.steps.find((x) => x.key === s.key)?.required;
            return (
              <li key={s.key}>
                <button type="button" onClick={() => setCurrent(s.key)} aria-current={s.key === step ? 'step' : undefined}
                  className={cn('flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted', s.key === step && 'bg-muted font-medium')}>
                  <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-xs', isDone ? 'border-transparent bg-green-700 text-white' : '')} aria-hidden>
                    {isDone ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span className="grid">
                    <span>{s.title}</span>
                    <span className="text-xs text-muted-foreground">{isDone ? 'Listo' : required ? 'Obligatorio' : 'Opcional'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <Button variant="ghost" size="sm" onClick={later} className="justify-start">Completar después</Button>
      </aside>

      <section aria-labelledby="step-title" className="grid content-start gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Paso {idx + 1} de {STEPS.length}</p>
          <h2 id="step-title" className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{STEPS[idx]!.title}</h2>
          <p className="text-sm text-muted-foreground">{STEPS[idx]!.hint}</p>
        </div>

        {step === 'profile' && <ProfileForm onSaved={next} />}
        {step === 'branding' && <BrandingForm onSaved={next} />}
        {step === 'hours' && <HoursForm onSaved={next} />}
        {step === 'services' && <ServicesManager />}
        {step === 'staff' && <StaffManager />}
        {step === 'whatsapp' && <Connection onSaved={next} />}
        {step === 'share' && (
          <div className="grid gap-4 rounded-xl border bg-card p-5">
            {ob.data.status === 'active' ? (
              <div className="flex items-center gap-3 text-green-800"><PartyPopper className="size-6" aria-hidden /><p className="font-medium">Tu barbería está publicada y recibiendo reservas.</p></div>
            ) : ob.data.canActivate ? (
              <p className="text-sm">Todo listo. Publica tu barbería para que tus clientes puedan reservar.</p>
            ) : (
              <Alert tone="info" title="Faltan pasos obligatorios">Completa: {ob.data.steps.filter((s) => s.required && !s.done).map((s) => STEPS.find((x) => x.key === s.key)!.title).join(', ')}.</Alert>
            )}
            <div className="grid gap-2">
              <span className="text-sm font-medium">Tu enlace de reservas</span>
              <div className="flex flex-wrap gap-2">
                <code className="rounded-md border bg-muted px-3 py-2 text-sm">{url}</code>
                <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(url); saved('Enlace copiado'); }}><Copy aria-hidden /> Copiar</Button>
                <a className={buttonVariants({ variant: 'outline' })} href={`https://wa.me/?text=${encodeURIComponent(`Reserva tu cita en ${shop.barbershop.name}: ${url}`)}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Compartir por WhatsApp</a>
              </div>
              <p className="text-xs text-muted-foreground">Ponlo en tu bio de Instagram y en tu estado de WhatsApp.</p>
            </div>
            {activate.error ? <Alert title={errorMessage(activate.error, i18n.t)} /> : null}
            {ob.data.status === 'onboarding' && (
              <Button variant="brand" size="lg" disabled={!ob.data.canActivate} loading={activate.isPending} onClick={() => { if (!done.get('share')) update.mutate({ data: { completeStep: 'share' } }); activate.mutate(); }}>
                Publicar mi barbería
              </Button>
            )}
            {ob.data.status === 'active' && <Link to=".." className={buttonVariants()}>Ir al inicio</Link>}
          </div>
        )}

        <div className="flex justify-between gap-2 border-t pt-4">
          <Button variant="ghost" disabled={idx === 0} onClick={() => go(STEPS[idx - 1]?.key)}>Anterior</Button>
          {step !== 'share' && (
            <Button variant={done.get(step) ? 'default' : 'outline'} onClick={skip}>
              {done.get(step) ? 'Siguiente' : SKIPPABLE.includes(step) ? 'Omitir por ahora' : 'Siguiente'}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
