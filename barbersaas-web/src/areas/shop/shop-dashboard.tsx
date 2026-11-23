import { CalendarDays, CalendarPlus, Clock, Coins, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { useOnboardingControllerGet, useShopAppointmentsControllerList } from '@/api/generated/endpoints';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { dayRange, formatDateLong, formatTime, localDate } from '@/lib/dates';
import { cn, formatMoney } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useCan, useShop } from './shop-context';
import { STATUS } from './agenda/status';

const STATUS_TONE = {
  awaiting_payment: 'warning',
  pending: 'warning',
  confirmed: 'info',
  in_progress: 'info',
  completed: 'success',
  no_show: 'danger',
  canceled: 'neutral',
} as const;

export function ShopDashboard() {
  const shop = useShop();
  // El barbero vive en "Mi día": el inicio general es para quien gestiona la barbería.
  if (shop.role === 'barber' && shop.staffId) return <Navigate to="mi-dia" replace />;
  return <Dashboard />;
}

function Dashboard() {
  const { t, i18n } = useTranslation();
  const shop = useShop();
  const user = useAuth((st) => st.user);
  const can = useCan();
  const tz = shop.barbershop.timezone;
  const today = localDate(new Date(), tz);
  const range = dayRange(today, tz);
  const appts = useShopAppointmentsControllerList(range, {
    query: { enabled: can(['appointments.view_all', 'appointments.view_own']), refetchInterval: 60_000 },
  });
  const onboarding = useOnboardingControllerGet({
    query: { enabled: shop.barbershop.status === 'onboarding' },
  });

  const list = appts.data ?? [];
  const active = list.filter((a) => a.status !== 'canceled');
  const upcoming = active
    .filter(
      (a) => new Date(a.endAt) > new Date() && ['pending', 'confirmed', 'in_progress'].includes(a.status),
    )
    .slice(0, 6);
  const income = active.filter((a) => a.status !== 'no_show').reduce((n, a) => n + a.totalCents, 0);
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'es-PE';

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:p-8">
      {/* Bienvenida con accesos rápidos (patrón de Cognira ERP) */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-marca-700 via-marca-900 to-noche p-6 text-white sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(31,195,238,0.35),transparent_55%)]" aria-hidden />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-celeste-100/90 first-letter:uppercase">{formatDateLong(new Date(), tz, locale)}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{greeting(user?.fullName)}</h1>
            <p className="mt-1 text-sm text-slate-300">{shop.barbershop.name}</p>
          </div>
          {can(['appointments.manage_all', 'appointments.manage_own']) && (
            <div className="flex flex-wrap gap-2">
              <Link to="agenda" className={cn(buttonVariants(), 'bg-white text-marca-800 hover:bg-white/90')}>
                <CalendarPlus aria-hidden /> Nueva cita
              </Link>
              <Link to="clientes" className={cn(buttonVariants({ variant: 'outline' }), 'border-white/20 bg-white/10 text-white hover:bg-white/20')}>
                <Users aria-hidden /> Clientes
              </Link>
            </div>
          )}
        </div>
      </section>

      {onboarding.data && onboarding.data.status === 'onboarding' && (
        <Card className="border-marca-200 bg-marca-50/40">
          <CardHeader>
            <CardTitle>{t('shop.onboarding')}</CardTitle>
            <CardDescription>
              {t('shop.onboardingProgress', { progress: onboarding.data.progress })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div
              className="h-2 overflow-hidden rounded-full bg-marca-100"
              role="progressbar"
              aria-valuenow={onboarding.data.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-gradient-to-r from-celeste-400 to-marca-700 transition-all"
                style={{ width: `${onboarding.data.progress}%` }}
              />
            </div>
            <Link
              to="onboarding"
              className={buttonVariants({ className: 'justify-self-start' })}
            >
              {t('shop.continue')}
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          tone="bg-marca-50 text-marca-700"
          icon={<CalendarDays aria-hidden />}
          label={t('shop.appointmentsToday')}
          value={appts.isPending ? null : String(active.length)}
        />
        <Kpi
          tone="bg-emerald-50 text-emerald-700"
          icon={<Coins aria-hidden />}
          label={t('shop.incomeToday')}
          value={appts.isPending ? null : formatMoney(income, shop.barbershop.currency, locale)}
        />
        <Kpi
          tone="bg-violet-50 text-violet-700"
          icon={<Clock aria-hidden />}
          label={t('shop.next')}
          value={appts.isPending ? null : String(upcoming.length)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('shop.next')}</CardTitle>
          <Link to="agenda" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('nav.agenda')}
          </Link>
        </CardHeader>
        <CardContent>
          {appts.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState title={active.length ? t('shop.noMoreToday') : t('shop.noAppointmentsToday')} />
          ) : (
            <ul className="divide-y">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3">
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">
                    {formatTime(a.startAt, tz, locale)}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{a.customer?.fullName ?? 'Walk-in'}</span>
                    <span className="text-muted-foreground truncate text-sm">
                      {a.items.map((i) => i.name).join(' + ')} · {a.staff.displayName}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[a.status]} className="gap-1">
                    {(() => {
                      const S = STATUS[a.status];
                      return (
                        <>
                          <S.icon className="size-3" aria-hidden /> {S.label}
                        </>
                      );
                    })()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string | null; tone: string }) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-5">
        <span className="flex items-start justify-between gap-3">
          <span className="text-sm text-slate-500">{label}</span>
          <span className={`grid size-9 place-items-center rounded-lg [&_svg]:size-5 ${tone}`}>{icon}</span>
        </span>
        {value === null ? <Skeleton className="h-8 w-20" /> : <span className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</span>}
      </CardContent>
    </Card>
  );
}

function greeting(name?: string | null): string {
  const h = new Date().getHours();
  const hi = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return name ? `${hi}, ${name.split(' ')[0]}` : hi;
}
