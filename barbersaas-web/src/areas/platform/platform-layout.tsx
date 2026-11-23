import { BookOpenText, CreditCard, FileText, Gauge, HandCoins, Layers, LogOut, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { BrandMark, Initials, Wordmark } from '@/components/brand';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { sideItem } from '@/components/side-item';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/features/auth/use-logout';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

const NAV = [
  { to: '', label: 'nav.dashboard', icon: Gauge, end: true, superOnly: true },
  { to: 'barberias', label: 'nav.barbershops', icon: Store },
  { to: 'planes', label: 'nav.plans', icon: Layers },
  { to: 'facturacion', label: 'nav.billing', icon: CreditCard, superOnly: true },
  { to: 'cobranza', label: 'nav.collections', icon: HandCoins, superOnly: true },
  { to: 'reclamaciones', label: 'nav.complaints', icon: BookOpenText },
  { to: 'auditoria', label: 'nav.audit', icon: FileText },
];

/** Panel de plataforma: barra lateral navy de la línea Cognira (en móvil, menú horizontal arriba). */
export function PlatformLayout() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user)!;
  const logout = useLogout();
  const items = NAV.filter((n) => !n.superOnly || user.platformRole === 'superadmin');
  return (
    <div className="min-h-dvh bg-slate-50">
      <aside className="z-30 flex flex-col bg-noche text-slate-300 md:fixed md:inset-y-0 md:left-0 md:w-64">
        <Link to="/platform" className="flex h-16 shrink-0 items-center gap-3 px-4">
          <BrandMark />
          <span className="grid min-w-0">
            <Wordmark tone="light" className="text-sm" />
            <span className="truncate text-xs text-amber-200/90">Plataforma · {t(`roles.${user.platformRole}`)}</span>
          </span>
        </Link>
        <nav aria-label="Plataforma" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-0.5 md:pt-2">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn(sideItem(isActive), 'shrink-0')}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-celeste-400 md:block" aria-hidden />}
                  <n.icon className={cn('size-5 shrink-0', isActive && 'text-celeste-300')} aria-hidden />
                  <span className="truncate">{t(n.label)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="hidden shrink-0 border-t border-white/5 p-3 md:block">
          <div className="flex items-center gap-3 rounded-xl p-2">
            <Initials name={user.fullName} />
            <span className="grid min-w-0">
              <span className="truncate text-sm font-medium text-white">{user.fullName}</span>
              <span className="truncate text-xs text-slate-400">{user.email}</span>
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
      <main className="min-w-0 md:pl-64">
        <Outlet />
      </main>
    </div>
  );
}
