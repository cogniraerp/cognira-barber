import { CircleCheck } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useAuthControllerVerifyEmail } from '@/api/generated/endpoints';
import { AuthShell } from '@/components/layout/auth-shell';
import { buttonVariants } from '@/components/ui/button-variants';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/stores/auth';

/** Link del correo de bienvenida: confirma el correo al abrirlo (repetirlo no es un error). */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const user = useAuth((s) => s.user);
  const verify = useAuthControllerVerifyEmail();
  const sent = useRef(false);
  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    verify.mutate({ data: { token } });
  }, [token, verify]);

  const next = user ? (user.platformRole ? '/platform' : '/cuenta') : '/login';
  return (
    <AuthShell title={t('auth.verifyTitle')}>
      {!token ? (
        <Alert title={t('auth.linkInvalid')} />
      ) : verify.isSuccess ? (
        <div role="status" className="grid justify-items-center gap-3 text-center">
          <CircleCheck className="size-10 text-emerald-600" aria-hidden />
          <p className="font-medium text-slate-900">{t('auth.verifyDone')}</p>
          <Link to={next} className={buttonVariants({ className: 'w-full' })}>
            {user ? t('auth.continue') : t('auth.login')}
          </Link>
        </div>
      ) : verify.error ? (
        <Alert title={errorMessage(verify.error, t)}>{t('auth.verifyRetryHint')}</Alert>
      ) : (
        <div role="status" aria-label={t('auth.verifying')} className="grid gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      )}
    </AuthShell>
  );
}
