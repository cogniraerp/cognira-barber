import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useAuthControllerForgotPassword } from '@/api/generated/endpoints';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';

const schema = z.object({ email: z.email() });
type Form = z.infer<typeof schema>;

/** "¿Olvidaste tu contraseña?": pide el link por correo. La respuesta es la misma exista o no la cuenta. */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const forgot = useAuthControllerForgotPassword();
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const onSubmit = form.handleSubmit((data) => forgot.mutateAsync({ data }).catch(() => null));

  return (
    <AuthShell
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link to="/login" className="text-foreground font-medium underline underline-offset-4">
          {t('auth.backToLogin')}
        </Link>
      }
    >
      {forgot.isSuccess ? (
        <div role="status" className="grid justify-items-center gap-3 text-center">
          <MailCheck className="text-marca-600 size-10" aria-hidden />
          <p className="font-medium text-slate-900">{t('auth.forgotSentTitle')}</p>
          <p className="text-muted-foreground text-sm">
            {t('auth.forgotSent', { email: form.getValues('email') })}
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {forgot.error ? <Alert title={errorMessage(forgot.error, t)} /> : null}
          <Field label={t('auth.email')} error={form.formState.errors.email && t('errors.VALIDATION_FAILED')}>
            {(p) => (
              <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
            )}
          </Field>
          <Button type="submit" loading={forgot.isPending} className="w-full">
            {t('auth.forgotSubmit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
