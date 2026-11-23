import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/stores/auth';

/** Exige sesión; si no, va al login conservando a dónde quería ir. */
export function RequireAuth() {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user)
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

/** Solo superadmin/soporte. */
export function RequirePlatform() {
  const user = useAuth((s) => s.user);
  if (!user?.platformRole) return <Navigate to="/cuenta" replace />;
  return <Outlet />;
}
