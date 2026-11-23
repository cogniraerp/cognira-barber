import { ChevronRight } from 'lucide-react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { PageHeader } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useCan } from '../shop-context';
import { SETTINGS_SECTIONS } from './sections';

/**
 * /s/:slug/configuracion/<sección>. En escritorio las secciones son un submenú de la barra
 * lateral; aquí solo va el título de la sección. En móvil (sin barra lateral) se muestran
 * como una fila deslizable.
 */
export function SettingsLayout() {
  const can = useCan();
  const { pathname } = useLocation();
  const items = SETTINGS_SECTIONS.filter((s) => can(s.perm));
  const current = items.find((s) => pathname.split('/').includes(s.to));
  // /configuracion sola (o una sección sin permiso) → la primera permitida.
  if (!current) return items[0] ? <Navigate to={items[0].to} replace /> : null;
  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        before={
          <p className="mb-1 flex items-center gap-1 text-sm text-slate-500">
            Configuración <ChevronRight className="size-3.5" aria-hidden />
          </p>
        }
        title={current.label}
        subtitle={current.description}
      />
      <nav aria-label="Configuración" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
        {items.map((s) => (
          <NavLink key={s.to} to={s.to}
            className={({ isActive }) => cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium', isActive ? 'border-marca-700 bg-marca-700 text-white' : 'border-slate-200 bg-white text-slate-600')}>
            <s.icon className="size-4" aria-hidden /> {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
