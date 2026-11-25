import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { env } from '@/lib/env';
import { currentHost } from '@/lib/tenant';
import { NotFound, RouteError } from '@/components/layout/route-error';
import { RequireAuth, RequirePlatform } from './guards';

/**
 * Cada área se carga como bundle separado (lazy): la página pública no descarga el panel
 * ni el de plataforma, y viceversa.
 */
const lazy =
  <T,>(load: () => Promise<T>, pick: (m: T) => ComponentType) =>
  async () => ({ Component: pick(await load()) });

const publicRoutes = (prefix: string): RouteObject[] => [
  {
    path: prefix || '/',
    lazy: lazy(
      () => import('@/areas/public/public-shop-page'),
      (m) => m.PublicShopPage,
    ),
  },
  {
    path: `${prefix}/libro-reclamaciones`,
    lazy: lazy(
      () => import('@/features/legal/complaints-book-page'),
      (m) => m.ShopComplaintsBookPage,
    ),
  },
  {
    path: `${prefix}/cita/:token`,
    lazy: lazy(
      () => import('@/areas/public/public-shop-page'),
      (m) => m.PublicShopPage,
    ),
  },
];

/** Términos y Privacidad: también en el subdominio de cada barbería (los enlaza su pie). */
const legalRoutes: RouteObject[] = [
  {
    path: '/terminos',
    lazy: lazy(
      () => import('@/features/legal/legal-pages'),
      (m) => m.TermsPage,
    ),
  },
  {
    path: '/privacidad',
    lazy: lazy(
      () => import('@/features/legal/legal-pages'),
      (m) => m.PrivacyPage,
    ),
  },
];

function appRoutes(): RouteObject[] {
  return [
    { path: '/', element: <Navigate to="/cuenta" replace /> },
    {
      path: '/login',
      lazy: lazy(
        () => import('@/features/auth/login-page'),
        (m) => m.LoginPage,
      ),
    },
    {
      path: '/registro',
      lazy: lazy(
        () => import('@/features/auth/register-page'),
        (m) => m.RegisterPage,
      ),
    },
    ...legalRoutes,
    {
      path: '/libro-reclamaciones',
      lazy: lazy(
        () => import('@/features/legal/complaints-book-page'),
        (m) => m.PlatformComplaintsBookPage,
      ),
    },
    {
      path: '/invitacion/:token',
      lazy: lazy(
        () => import('@/features/auth/invitation-page'),
        (m) => m.InvitationPage,
      ),
    },
    {
      path: '/recuperar',
      lazy: lazy(
        () => import('@/features/auth/forgot-password-page'),
        (m) => m.ForgotPasswordPage,
      ),
    },
    {
      path: '/restablecer',
      lazy: lazy(
        () => import('@/features/auth/reset-password-page'),
        (m) => m.ResetPasswordPage,
      ),
    },
    {
      path: '/verificar-correo',
      lazy: lazy(
        () => import('@/features/auth/verify-email-page'),
        (m) => m.VerifyEmailPage,
      ),
    },
    // Página pública también por ruta: barbersaas.com/b/{slug}
    ...publicRoutes('/b/:slug'),
    {
      element: <RequireAuth />,
      children: [
        {
          path: '/cuenta',
          lazy: lazy(
            () => import('@/features/account/account-page'),
            (m) => m.AccountPage,
          ),
        },
        {
          path: '/s/:slug',
          lazy: lazy(
            () => import('@/areas/shop/shop-layout'),
            (m) => m.ShopLayout,
          ),
          children: [
            {
              index: true,
              lazy: lazy(
                () => import('@/areas/shop/shop-dashboard'),
                (m) => m.ShopDashboard,
              ),
            },
            { path: 'agenda', lazy: lazy(() => import('@/areas/shop/agenda/agenda-page'), (m) => m.AgendaPage) },
            { path: 'clientes', lazy: lazy(() => import('@/areas/shop/customers/customers-page'), (m) => m.CustomersPage) },
            { path: 'clientes/:id', lazy: lazy(() => import('@/areas/shop/customers/customer-detail-page'), (m) => m.CustomerDetailPage) },
            { path: 'mi-dia', lazy: lazy(() => import('@/areas/shop/my-day/my-day-page'), (m) => m.MyDayPage) },
            { path: 'caja', element: <Navigate to="cobrar" replace /> },
            { path: 'caja/cobrar', lazy: lazy(() => import('@/areas/shop/sales/pos-page'), (m) => m.PosPage) },
            { path: 'caja/ventas', lazy: lazy(() => import('@/areas/shop/sales/sales-page'), (m) => m.SalesPage) },
            { path: 'caja/turno', lazy: lazy(() => import('@/areas/shop/cash/cash-page'), (m) => m.CashPage) },
            { path: 'reportes', lazy: lazy(() => import('@/areas/shop/reports/reports-page'), (m) => m.ReportsPage) },
            { path: 'comisiones', lazy: lazy(() => import('@/areas/shop/commissions/commissions-page'), (m) => m.CommissionsPage) },
            { path: 'mis-comisiones', lazy: lazy(() => import('@/areas/shop/commissions/my-commissions-page'), (m) => m.MyCommissionsPage) },
            { path: 'inventario', element: <Navigate to="productos" replace /> },
            { path: 'inventario/productos', lazy: lazy(() => import('@/areas/shop/inventory/products-page'), (m) => m.ProductsPage) },
            { path: 'inventario/movimientos', lazy: lazy(() => import('@/areas/shop/inventory/movements-page'), (m) => m.MovementsPage) },
            { path: 'onboarding', lazy: lazy(() => import('@/areas/shop/onboarding-page'), (m) => m.OnboardingPage) },
            { path: 'servicios', lazy: lazy(() => import('@/areas/shop/settings/services-page'), (m) => m.ServicesPage) },
            { path: 'barberos', lazy: lazy(() => import('@/areas/shop/settings/staff-page'), (m) => m.StaffPage) },
            { path: 'mensajes', lazy: lazy(() => import('@/areas/shop/settings/whatsapp-page'), (m) => m.WhatsAppPage) },
            {
              path: 'configuracion',
              lazy: lazy(() => import('@/areas/shop/settings/settings-layout'), (m) => m.SettingsLayout),
              children: [
                // Sin sección: el layout redirige a la primera que el rol puede ver.
                { index: true, element: null },
                { path: 'perfil', lazy: lazy(() => import('@/areas/shop/settings/settings-pages'), (m) => m.ProfileSettings) },
                { path: 'marca', lazy: lazy(() => import('@/areas/shop/settings/settings-pages'), (m) => m.BrandingSettings) },
                { path: 'horarios', lazy: lazy(() => import('@/areas/shop/settings/settings-pages'), (m) => m.HoursSettings) },
                { path: 'reglas', lazy: lazy(() => import('@/areas/shop/settings/settings-pages'), (m) => m.RulesSettings) },
                { path: 'usuarios', lazy: lazy(() => import('@/areas/shop/settings/settings-pages'), (m) => m.MembersSettings) },
                { path: 'pagos', lazy: lazy(() => import('@/areas/shop/settings/payments-page'), (m) => m.PaymentsSettings) },
                { path: 'reclamaciones', lazy: lazy(() => import('@/areas/shop/settings/complaints-page'), (m) => m.ComplaintsSettings) },
                { path: 'dominio', lazy: lazy(() => import('@/areas/shop/settings/domain-page'), (m) => m.DomainSettings) },
                { path: 'suscripcion', lazy: lazy(() => import('@/areas/shop/settings/subscription-page'), (m) => m.SubscriptionSettings) },
                { path: 'general', lazy: lazy(() => import('@/areas/shop/settings/settings-pages'), (m) => m.GeneralSettings) },
              ],
            },
            // Módulos de los pasos 14–17 (por ahora, "en construcción").
            {
              path: '*',
              lazy: lazy(
                () => import('@/components/layout/coming-soon'),
                (m) => m.ComingSoon,
              ),
            },
          ],
        },
        {
          element: <RequirePlatform />,
          children: [
            {
              path: '/platform',
              lazy: lazy(
                () => import('@/areas/platform/platform-layout'),
                (m) => m.PlatformLayout,
              ),
              children: [
                {
                  index: true,
                  lazy: lazy(
                    () => import('@/areas/platform/platform-dashboard'),
                    (m) => m.PlatformDashboard,
                  ),
                },
                { path: 'barberias', lazy: lazy(() => import('@/areas/platform/barbershops-page'), (m) => m.BarbershopsPage) },
                { path: 'barberias/:id', lazy: lazy(() => import('@/areas/platform/barbershop-detail-page'), (m) => m.BarbershopDetailPage) },
                { path: 'planes', lazy: lazy(() => import('@/areas/platform/plans-page'), (m) => m.PlansPage) },
                { path: 'facturacion', lazy: lazy(() => import('@/areas/platform/billing-page'), (m) => m.BillingPage) },
                { path: 'cobranza', lazy: lazy(() => import('@/areas/platform/collections-page'), (m) => m.CollectionsPage) },
                { path: 'reclamaciones', lazy: lazy(() => import('@/areas/platform/complaints-page'), (m) => m.ComplaintsPage) },
                { path: 'whatsapp', lazy: lazy(() => import('@/areas/platform/whatsapp-page'), (m) => m.PlatformWhatsAppPage) },
                { path: 'auditoria', lazy: lazy(() => import('@/areas/platform/audit-page'), (m) => m.AuditPage) },
              ],
            },
          ],
        },
      ],
    },
    { path: '*', element: <NotFound /> },
  ];
}

export function createRouter() {
  const host = currentHost(env.rootDomain);
  const routes =
    host.kind === 'shop-public' ? [...publicRoutes(''), ...legalRoutes, { path: '*', element: <NotFound /> }] : appRoutes();
  return createBrowserRouter([{ errorElement: <RouteError />, children: routes }]);
}
