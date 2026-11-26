import { QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Boxes,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  HandCoins,
  Home,
  LogOut,
  MessageCircle,
  Package,
  ReceiptText,
  Scissors,
  Settings,
  ShoppingCart,
  Store,
  UserRound,
  Users,
  Wallet, ChartColumn } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { EmailVerifyBanner } from '@/components/account/email-verify-banner';
import { WhatsAppDisconnectedBanner } from '@/components/whatsapp/disconnected-banner';
import { SuspendedScreen } from './suspended-screen';
import { BrandMark, Initials, Wordmark } from '@/components/brand';
import { sideItem } from '@/components/side-item';
import { isApiError } from '@/api/errors';
import { useProfileControllerGetBranding, useShopContextControllerGet } from '@/api/generated/endpoints';
import { tenantQueryClient } from '@/app/query-client';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Alert, Badge, Spinner } from '@/components/ui/misc';
import { useLogout } from '@/features/auth/use-logout';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { shopPageUrl } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/use-now';
import { useAuth } from '@/stores/auth';
import { useTenant } from '@/stores/tenant';
import { SETTINGS_SECTIONS } from './settings/sections';
import { ShopCtx } from './shop-context';

/** /s/:slug — caché aislada por barbería + contexto + marca + navegación según permisos. */
export function ShopLayout() {
  const { slug = '' } = useParams();
  const client = useMemo(() => tenantQueryClient(slug), [slug]);
  useEffect(() => useTenant.getState().setSlug(slug), [slug]);
  return (
    <QueryClientProvider client={client}>
      <ShopShell slug={slug} />
    </QueryClientProvider>
  );
}

interface NavChild {
  to: string;
  label: string;
  icon: typeof Home;
  perms: string[];
}
interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  perms?: string[];
  end?: boolean;
  staffOnly?: boolean;
  /** Submenú: cada hijo es una ruta propia (`<to>/<hijo>`). */
  children?: NavChild[];
}
const INVENTORY_VIEW = ['products.manage', 'inventory.manage', 'cash.manage'];

/** Menú por secciones plegables, como en Cognira ERP. */
const SECTIONS: Array<{ id: string; title?: string; items: NavItem[] }> = [
  {
    id: 'operacion',
    title: 'Operación',
    items: [
      { to: '', label: 'nav.dashboard', icon: Home, perms: ['dashboard.view'], end: true },
      { to: 'agenda', label: 'nav.agenda', icon: CalendarDays, perms: ['appointments.view_all', 'appointments.view_own'] },
      { to: 'mi-dia', label: 'nav.myDay', icon: Scissors, staffOnly: true },
      { to: 'mis-comisiones', label: 'nav.myCommissions', icon: HandCoins, staffOnly: true, perms: ['commissions.view_own'] },
      {
        to: 'caja',
        label: 'nav.cash',
        icon: Wallet,
        children: [
          { to: 'cobrar', label: 'Cobrar', icon: ShoppingCart, perms: ['sales.create'] },
          { to: 'ventas', label: 'Ventas', icon: ReceiptText, perms: ['sales.create'] },
          { to: 'turno', label: 'Turno de caja', icon: Wallet, perms: ['cash.manage'] },
        ],
      },
      { to: 'clientes', label: 'nav.customers', icon: Users, perms: ['customers.view'] },
    ],
  },
  {
    id: 'negocio',
    title: 'Negocio',
    items: [
      { to: 'reportes', label: 'nav.reports', icon: ChartColumn, perms: ['reports.view'] },
      { to: 'comisiones', label: 'nav.commissions', icon: HandCoins, perms: ['commissions.manage'] },
      {
        to: 'inventario',
        label: 'nav.inventory',
        icon: Package,
        children: [
          { to: 'productos', label: 'Productos', icon: Boxes, perms: INVENTORY_VIEW },
          { to: 'movimientos', label: 'Movimientos', icon: ArrowLeftRight, perms: INVENTORY_VIEW },
        ],
      },
    ],
  },
  {
    id: 'barberia',
    title: 'Mi barbería',
    items: [
      { to: 'servicios', label: 'nav.services', icon: Store, perms: ['services.manage'] },
      { to: 'barberos', label: 'nav.staff', icon: UserRound, perms: ['staff.manage'] },
      { to: 'mensajes', label: 'nav.messages', icon: MessageCircle, perms: ['whatsapp.manage'] },
      {
        to: 'configuracion',
        label: 'nav.settings',
        icon: Settings,
        children: SETTINGS_SECTIONS.map((x) => ({ to: x.to, label: x.label, icon: x.icon, perms: [x.perm] })),
      },
    ],
  },
];

/** Aviso permanente mientras se opera como otra persona + salida que vuelve al panel de plataforma. */
function ImpersonationBanner({ role }: { role: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const imp = useAuth((s) => s.impersonation);
  const exit = () => {
    const back = imp ? `/platform/barberias/${imp.barbershopId}` : '/platform';
    useAuth.getState().setImpersonation(null);
    navigate(back);
  };
  const now = useNow(30_000);
  const minutes = imp ? Math.max(0, Math.round((imp.expiresAt - now) / 60_000)) : 0;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span>{t('shop.impersonating', { role: t(`roles.${role}`) })}{imp && ` · vence en ${minutes} min`}</span>
      <Button size="sm" variant="outline" className="h-7 border-amber-300 bg-white" onClick={exit}>Salir</Button>
    </div>
  );
}

function ShopShell({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const logout = useLogout();
  const ctx = useShopContextControllerGet({ query: { retry: false } });
  const location = useLocation();
  const user = useAuth((st) => st.user);
  const branding = useProfileControllerGetBranding({ query: { enabled: ctx.isSuccess } });


  if (ctx.isPending)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  if (ctx.error) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 p-6">
        <Alert
          title={
            isApiError(ctx.error, 'TENANT_NOT_FOUND')
              ? t('errors.TENANT_NOT_FOUND')
              : errorMessage(ctx.error, t)
          }
        />
        <Link to="/cuenta" className={buttonVariants({ variant: 'outline' })}>
          {t('account.title')}
        </Link>
      </main>
    );
  }

  const c = ctx.data;
  const perms = new Set<string>(c.permissions);
  const allowed = (n: NavItem) => (!n.staffOnly || Boolean(c.staffId)) && (!n.perms || n.perms.some((p) => perms.has(p)));
  const childrenOf = (n: NavItem) => (n.children ?? []).filter((ch) => ch.perms.some((p) => perms.has(p)));
  const sections = SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter((n) => (n.children ? childrenOf(n).length > 0 : allowed(n))),
  })).filter((sec) => sec.items.length > 0);
  // Barra inferior (móvil): las primeras 5 entradas directas.
  const items = sections.flatMap((sec) => sec.items).filter((n) => !n.children);
  const logo = branding.data?.logoUrl;
  const suspended = c.barbershop.status === 'suspended';
  const onBilling = location.pathname.startsWith(`/s/${slug}/configuracion/suscripcion`);
  const isActive = (to: string, end?: boolean) => {
    const base = `/s/${slug}${to ? `/${to}` : ''}`;
    return end ? location.pathname === base || location.pathname === `${base}/` : location.pathname.startsWith(base);
  };

  return (
    <ShopCtx.Provider value={c}>
      <div className="min-h-dvh bg-slate-50">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-lg focus:bg-white focus:p-2">
          Saltar al contenido
        </a>
        {/* Barra lateral navy (escritorio) — línea Cognira */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-noche text-slate-300 md:flex">
          <Link to="/cuenta" className="flex h-16 shrink-0 items-center gap-3 px-4" title={t('account.title')}>
            <BrandMark light={false} />
            <span className="grid min-w-0">
              <Wordmark tone="light" className="text-sm" />
              <span className="truncate text-xs text-slate-400">{c.barbershop.name}</span>
            </span>
          </Link>
          <nav aria-label="Principal" className="flex-1 space-y-0.5 overflow-y-auto px-3 pt-2 pb-4">
            {sections.map((sec, si) => (
              <NavSection key={sec.id} id={sec.id} title={sec.title} first={si === 0} hasActive={sec.items.some((n) => isActive(n.to, n.end))}>
                {sec.items.map((n) => {
                  const active = isActive(n.to, n.end);
                  if (n.children) {
                    return (
                      <NavGroup key={n.to} id={n.to} label={t(n.label)} icon={n.icon} active={active}
                        items={childrenOf(n).map((ch) => ({ ...ch, to: `${n.to}/${ch.to}` }))} isActive={(to) => isActive(to)} />
                    );
                  }
                  return (
                    <NavLink key={n.to} to={n.to} end={n.end} className={sideItem(active)}>
                      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-celeste-400" aria-hidden />}
                      <n.icon className={cn('size-5 shrink-0', active && 'text-celeste-300')} aria-hidden />
                      <span className="truncate">{t(n.label)}</span>
                    </NavLink>
                  );
                })}
              </NavSection>
            ))}
            <a href={shopPageUrl(slug, { rootDomain: env.rootDomain, subdomains: env.publicSubdomains })} target="_blank" rel="noreferrer" className={cn(sideItem(false), 'mt-3')}>
              <ExternalLink className="size-5 shrink-0" aria-hidden />
              <span className="truncate">{t('nav.publicPage')}</span>
            </a>
          </nav>
          <div className="shrink-0 border-t border-white/5 p-3">
            <div className="flex items-center gap-3 rounded-xl p-2">
              {logo ? <img src={logo} alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <Initials name={user?.fullName ?? c.barbershop.name} />}
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium text-white">{user?.fullName ?? user?.email}</span>
                <span className="truncate text-xs text-slate-400">{c.customRole?.name ?? t(`roles.${c.role}`)}</span>
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between [&_button]:text-slate-300 [&_button:hover]:bg-white/5 [&_button:hover]:text-white">
              <LanguageToggle />
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                <LogOut aria-hidden /> {t('app.logout')}
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex min-h-dvh min-w-0 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-64">
          {/* Encabezado (móvil) */}
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
            <Link to="/cuenta" className="flex min-w-0 items-center gap-2">
              <BrandMark className="size-8" />
              <span className="truncate font-semibold text-slate-900">{c.barbershop.name}</span>
            </Link>
            <Badge tone="info">{c.customRole?.name ?? t(`roles.${c.role}`)}</Badge>
          </header>
          {c.impersonatedBy && <ImpersonationBanner role={c.impersonatedBy} />}
          {!c.impersonatedBy && <EmailVerifyBanner />}
          {perms.has('whatsapp.manage') && <WhatsAppDisconnectedBanner slug={slug} />}
          {suspended && onBilling && (
            <div className="bg-red-50 px-4 py-2 text-center text-sm text-red-800">{t('shop.suspended')}</div>
          )}
          <main id="main" className="flex-1">
            {/* Suspendida: solo se puede entrar a Suscripción (para pagar y reactivar). */}
            {suspended && !onBilling ? (
              <SuspendedScreen reason={c.barbershop.suspendedReason} canPay={perms.has('billing.manage')} slug={slug} />
            ) : (
              <Outlet />
            )}
          </main>
        </div>

        {/* Navegación inferior (móvil) */}
        <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 grid grid-flow-col border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {items.slice(0, 5).map((n) => {
            const active = isActive(n.to, n.end);
            return (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={cn('relative grid justify-items-center gap-0.5 px-1 py-2 text-[11px]', active ? 'font-medium text-marca-700' : 'text-slate-500')}>
                {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-marca-700" aria-hidden />}
                <n.icon className="size-5" aria-hidden />
                <span className="truncate">{t(n.label)}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </ShopCtx.Provider>
  );
}

/** Sección plegable del menú ("OPERACIÓN", "NEGOCIO"…). No se pliega si contiene la página actual. */
function NavSection({ id, title, first, hasActive, children }: { id: string; title?: string; first: boolean; hasActive: boolean; children: ReactNode }) {
  const key = `cognira:menu-seccion-${id}`;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(key) === '1');
  const hidden = collapsed && !hasActive;
  return (
    <div className={cn(!first && 'mt-4')}>
      {title && (
        <button type="button" aria-expanded={!hidden} onClick={() => { localStorage.setItem(key, hidden ? '0' : '1'); setCollapsed(!hidden); }}
          className="mb-1 flex w-full items-center justify-between rounded-md px-3 py-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase hover:text-slate-300">
          {title}
          <ChevronDown className={cn('size-3.5 transition-transform', hidden && '-rotate-90')} aria-hidden />
        </button>
      )}
      {!hidden && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

/**
 * Ítem desplegable del menú lateral (Inventario, Configuración…). Se abre solo al estar en una de
 * sus rutas; si no, recuerda si el usuario lo dejó abierto.
 */
function NavGroup({
  id,
  label,
  icon: Icon,
  active,
  items,
  isActive,
}: {
  id: string;
  label: string;
  icon: typeof Home;
  active: boolean;
  items: NavChild[];
  isActive: (to: string) => boolean;
}) {
  const key = `cognira:menu-${id}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) === '1');
  const expanded = active || open;
  const toggle = () => {
    const next = !expanded;
    setOpen(next);
    localStorage.setItem(key, next ? '1' : '0');
  };
  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={`submenu-${id}`} className={cn(sideItem(active), 'w-full')}>
        {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-celeste-400" aria-hidden />}
        <Icon className={cn('size-5 shrink-0', active && 'text-celeste-300')} aria-hidden />
        <span className="truncate">{label}</span>
        <ChevronDown className={cn('ml-auto size-4 text-slate-500 transition-transform', !expanded && '-rotate-90')} aria-hidden />
      </button>
      {expanded && (
        <ul id={`submenu-${id}`} className="mt-0.5 ml-5 space-y-0.5 border-l border-white/10 pl-3">
          {items.map((x) => {
            const on = isActive(x.to);
            return (
              <li key={x.to}>
                <NavLink to={x.to} aria-current={on ? 'page' : undefined}
                  className={cn('flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors', on ? 'bg-white/10 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100')}>
                  <x.icon className={cn('size-4 shrink-0', on && 'text-celeste-300')} aria-hidden />
                  <span className="truncate">{x.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
