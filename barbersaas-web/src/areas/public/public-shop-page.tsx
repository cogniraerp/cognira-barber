import { CalendarCheck, Clock, Globe, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { usePublicBookingControllerShop } from '@/api/generated/endpoints';
import type { PublicShopDtoOutput } from '@/api/generated/model';
import { LegalLinks } from '@/components/legal/legal-links';
import { NotFound } from '@/components/layout/route-error';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/misc';
import { formatDateLong, formatTime, toWall } from '@/lib/dates';
import { env } from '@/lib/env';
import { currentHost } from '@/lib/tenant';
import { applyBrandTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Avatar, BookingWizard, type Selection, type Step } from './booking-wizard';
import { ManageAppointment } from './manage-appointment';
import { DAY_NAMES, EMPTY, mapsUrl, money, openStatus, savedBookings } from './public-utils';

const STEPS: Step[] = ['servicios', 'barbero', 'horario', 'datos', 'listo'];

/**
 * Página pública de la barbería ({slug}.dominio o /b/:slug): presentación, servicios, equipo,
 * galería, horario y ubicación; el asistente de reserva (?reservar=…) y la gestión por enlace (/cita/:token).
 */
export function PublicShopPage() {
  const params = useParams();
  const host = currentHost(env.rootDomain);
  const slug = host.kind === 'shop-public' ? host.slug : (params.slug ?? '');
  const base = host.kind === 'shop-public' ? '' : `/b/${slug}`;
  const shop = usePublicBookingControllerShop(slug, { query: { retry: false, staleTime: 60_000 } });

  useEffect(() => {
    if (!shop.data) return;
    document.title = shop.data.name;
    applyBrandTheme(document.documentElement, shop.data.branding);
  }, [shop.data]);

  if (params.token) return <ManageAppointment token={params.token} homeHref={base || '/'} />;
  if (shop.isPending)
    return (
      <div className="mx-auto grid max-w-3xl gap-4 p-6">
        <Skeleton className="h-56" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  if (shop.error || !shop.data) return <NotFound />;
  return <Shop shop={shop.data} base={base} />;
}

function Shop({ shop, base }: { shop: PublicShopDtoOutput; base: string }) {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('reservar') as Step | null;
  const step = raw && STEPS.includes(raw) ? raw : null;
  const [sel, setSel] = useState<Selection>(EMPTY);

  const go = useCallback(
    (s: Step | null, replace = false) => {
      setSp((prev) => {
        const next = new URLSearchParams(prev);
        if (s) next.set('reservar', s);
        else next.delete('reservar');
        return next;
      }, { replace });
      window.scrollTo({ top: 0 });
    },
    [setSp],
  );
  const start = (serviceId?: string) => {
    setSel({ ...EMPTY, serviceIds: serviceId ? [serviceId] : [] });
    go(serviceId ? (shop.booking.allowStaffSelection ? 'barbero' : 'horario') : 'servicios');
  };

  if (step) {
    return (
      <BookingWizard shop={shop} step={step} go={go} sel={sel} setSel={setSel}
        manageHref={(t) => `${base}/cita/${t}`} onClose={() => { setSel(EMPTY); go(null); }} />
    );
  }
  return <Landing shop={shop} base={base} onBook={start} />;
}

function Landing({ shop, base, onBook }: { shop: PublicShopDtoOutput; base: string; onBook: (serviceId?: string) => void }) {
  const tz = shop.timezone;
  const loc = shop.locations.find((l) => l.isPrimary) ?? shop.locations[0];
  const wallNow = toWall(new Date(), tz);
  const status = loc ? openStatus(loc.hours, wallNow) : null;
  const maps = loc ? mapsUrl(loc, shop.name) : null;
  const b = shop.branding;
  const socials = socialLinks(b.socials);
  const wa = b.socials.whatsapp ?? shop.phone;
  const waUrl = wa ? `https://wa.me/${wa.replace(/\D/g, '')}` : null;
  const now = new Date().toISOString();
  const next = savedBookings(shop.slug).filter((x) => x.startAt > now).sort((x, y) => x.startAt.localeCompare(y.startAt))[0];

  const groups = [
    ...shop.categories.map((c) => ({ id: c.id, name: c.name, items: shop.services.filter((s) => s.categoryId === c.id) })),
    { id: 'none', name: shop.categories.length ? 'Otros' : '', items: shop.services.filter((s) => !s.categoryId || !shop.categories.some((c) => c.id === s.categoryId)) },
  ].filter((g) => g.items.length);

  return (
    <div className="min-h-dvh pb-24 sm:pb-0">
      <header className="relative overflow-hidden bg-brand text-brand-foreground">
        {b.bannerUrl && (
          <>
            <img src={b.bannerUrl} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/20" aria-hidden />
          </>
        )}
        <div className={cn('relative mx-auto grid max-w-3xl gap-4 px-5 pt-10 pb-8 sm:px-6 sm:pt-16', b.bannerUrl && 'text-white')}>
          {b.logoUrl && <img src={b.logoUrl} alt="" className="size-20 rounded-2xl bg-white object-cover shadow-md" />}
          <div className="grid gap-2">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{shop.name}</h1>
            {(b.welcomeMessage || shop.description) && <p className="max-w-xl text-base opacity-90">{b.welcomeMessage ?? shop.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {status && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 font-medium">
                <span className={cn('size-2 rounded-full', status.open ? 'bg-emerald-400' : 'bg-zinc-300')} aria-hidden />
                {status.label}
              </span>
            )}
            {loc?.address && (
              maps ? (
                <a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 opacity-90 hover:underline"><MapPin className="size-4" aria-hidden />{loc.address}</a>
              ) : <span className="inline-flex items-center gap-1.5 opacity-90"><MapPin className="size-4" aria-hidden />{loc.address}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => onBook()}
              className={cn(buttonVariants({ size: 'lg' }), b.bannerUrl ? 'bg-white text-zinc-900 hover:bg-white/90' : 'bg-brand-foreground text-brand hover:opacity-90')}>
              <CalendarCheck aria-hidden /> Reservar cita
            </button>
            {waUrl && (
              <a href={waUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'border-current bg-transparent text-current hover:bg-white/10')}>
                <MessageCircle aria-hidden /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-3xl gap-10 px-5 py-8 sm:px-6">
        {next && (
          <Link to={`${base}/cita/${next.token}`} className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/5 p-4">
            <CalendarCheck className="size-6 shrink-0 text-brand" aria-hidden />
            <span className="grid">
              <span className="font-medium">Tienes una cita</span>
              <span className="text-sm text-muted-foreground first-letter:uppercase">{formatDateLong(new Date(next.startAt), tz)} · {formatTime(next.startAt, tz)} — ver o cambiar</span>
            </span>
          </Link>
        )}

        <section className="grid gap-4" aria-labelledby="servicios">
          <h2 id="servicios" className="text-xl font-semibold">Servicios</h2>
          {groups.length === 0 && <p className="text-muted-foreground">Pronto publicaremos nuestros servicios.</p>}
          {groups.map((g) => (
            <div key={g.id} className="grid gap-2">
              {g.name && <h3 className="text-sm font-medium text-muted-foreground">{g.name}</h3>}
              <ul className="divide-y rounded-xl border bg-card">
                {g.items.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 p-3 sm:p-4">
                    {s.imageUrl && <img src={s.imageUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" />}
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="font-medium">{s.name}</span>
                      {s.description && <span className="line-clamp-2 text-sm text-muted-foreground">{s.description}</span>}
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{s.durationMin} min</span>
                        <span className="font-semibold text-foreground tabular-nums">{money(shop, s.priceFromCents, s.priceToCents)}</span>
                      </span>
                    </span>
                    <Button variant="outline" size="sm" onClick={() => onBook(s.id)} aria-label={`Reservar ${s.name}`}>Reservar</Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {shop.staff.length > 0 && (
          <section className="grid gap-4" aria-labelledby="equipo">
            <h2 id="equipo" className="text-xl font-semibold">Nuestro equipo</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shop.staff.map((st) => (
                <li key={st.id} className="grid justify-items-center gap-2 rounded-xl border bg-card p-4 text-center">
                  <Avatar name={st.displayName} url={st.photoUrl} className="size-20" />
                  <span className="font-medium">{st.displayName}</span>
                  {st.specialties.length > 0 && <span className="text-xs text-muted-foreground">{st.specialties.join(' · ')}</span>}
                  {st.bio && <span className="line-clamp-3 text-sm text-muted-foreground">{st.bio}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {shop.gallery.length > 0 && (
          <section className="grid gap-4" aria-labelledby="galeria">
            <h2 id="galeria" className="text-xl font-semibold">Galería</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shop.gallery.map((g) => (
                <li key={g.url}>
                  <figure className="grid gap-1">
                    <img src={g.url} alt={g.caption ?? ''} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                    {g.caption && <figcaption className="text-xs text-muted-foreground">{g.caption}</figcaption>}
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}

        {loc && (
          <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="horario">
            <div className="grid content-start gap-3">
              <h2 id="horario" className="text-xl font-semibold">Horario</h2>
              <table className="text-sm">
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const blocks = loc.hours.find((h) => h.dayOfWeek === d)?.blocks ?? [];
                    const today = d === wallNow.getDay();
                    return (
                      <tr key={d} className={cn(today && 'font-semibold')}>
                        <th scope="row" className="py-1 pr-4 text-left font-[inherit]">{DAY_NAMES[d]}{today ? ' (hoy)' : ''}</th>
                        <td className="py-1 tabular-nums">{blocks.length ? blocks.map((x) => `${x.start}–${x.end}`).join(' · ') : <span className="text-muted-foreground">Cerrado</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid content-start gap-3 text-sm">
              <h2 className="text-xl font-semibold">Cómo llegar</h2>
              {loc.address && <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />{loc.address}{loc.reference ? ` (${loc.reference})` : ''}</p>}
              {maps && <a href={maps} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'outline' }), 'justify-self-start')}><MapPin aria-hidden /> Abrir en Google Maps</a>}
              {shop.phone && <a href={`tel:${shop.phone}`} className="flex items-center gap-1.5 hover:underline"><Phone className="size-4" aria-hidden />{shop.phone}</a>}
              {socials.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {socials.map((s) => (
                    <li key={s.label}><a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted"><Globe className="size-3.5" aria-hidden />{s.label}</a></li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="grid gap-3 border-t py-6 pb-24 text-center text-xs text-muted-foreground sm:pb-6">
        <LegalLinks bookHref={`${base}/libro-reclamaciones`} />
        <span>Reservas con Cognira Barber</span>
      </footer>

      {/* Móvil: el botón de reservar siempre a mano. */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur sm:hidden">
        <Button variant="brand" size="lg" className="w-full" onClick={() => onBook()}><CalendarCheck aria-hidden /> Reservar cita</Button>
      </div>
    </div>
  );
}

function socialLinks(s: Record<string, string | null>): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  const handle = (v: string) => v.replace(/^@/, '');
  if (s.instagram) out.push({ label: 'Instagram', href: s.instagram.startsWith('http') ? s.instagram : `https://instagram.com/${handle(s.instagram)}` });
  if (s.tiktok) out.push({ label: 'TikTok', href: s.tiktok.startsWith('http') ? s.tiktok : `https://www.tiktok.com/@${handle(s.tiktok)}` });
  if (s.facebook) out.push({ label: 'Facebook', href: s.facebook.startsWith('http') ? s.facebook : `https://facebook.com/${handle(s.facebook)}` });
  if (s.website) out.push({ label: 'Sitio web', href: s.website });
  return out;
}
