import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { buttonVariants } from '@/components/ui/button-variants';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid gap-3">
        <p className="text-5xl font-bold">404</p>
        <h1 className="text-lg font-medium">{t('errors.notFoundPage')}</h1>
        <Link to="/" className={buttonVariants({ variant: 'outline' })}>
          {t('app.back')}
        </Link>
      </div>
    </main>
  );
}

/** Errores de render/carga de ruta (p. ej. un chunk que no se pudo descargar tras un deploy). */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  if (import.meta.env.DEV) console.error(error);
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="grid gap-3">
        <h1 className="text-lg font-medium">{t('errors.INTERNAL')}</h1>
        <button className={buttonVariants()} onClick={() => window.location.reload()}>
          {t('app.retry')}
        </button>
      </div>
    </main>
  );
}
