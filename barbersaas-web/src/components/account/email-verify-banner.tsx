import { MailWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMeControllerGet, useMeControllerResendVerification } from '@/api/generated/endpoints';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';

/** Aviso suave: el correo aún no está confirmado (no bloquea nada). */
export function EmailVerifyBanner({ className }: { className?: string }) {
  const { t } = useTranslation();
  const me = useMeControllerGet({ query: { staleTime: 60_000 } });
  const resend = useMeControllerResendVerification();
  if (!me.data || me.data.emailVerifiedAt) return null;
  return (
    <div role="status" className={`flex items-start gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900 ${className ?? ''}`}>
      <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t('auth.verifyBanner', { email: me.data.email })}</span>
        {resend.isSuccess ? (
          <span className="font-medium">{t('auth.verifyResent')}</span>
        ) : (
          <Button size="sm" variant="outline" className="h-7 bg-white" loading={resend.isPending} onClick={() => resend.mutate()}>
            {t('auth.verifyResend')}
          </Button>
        )}
        {resend.error ? <span className="font-medium">{errorMessage(resend.error, t)}</span> : null}
      </div>
    </div>
  );
}
