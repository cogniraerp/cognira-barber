import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useAuthControllerResetPassword } from '@/api/generated/endpoints';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';

const schema = z
  .object({ password: z.string().min(8).max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'] });
type Form = z.infer<typeof schema>;

/** Link del correo: elegir una contraseña nueva (cierra todas las sesiones). */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const reset = useAuthControllerResetPassword();
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(({ password }) =>
    reset.mutateAsync({ data: { token, password } }).catch(() => null),
  );
  const errs = form.formState.errors;

  return (
    <AuthShell title={t('auth.resetTitle')} subtitle={reset.isSuccess ? undefined : t('auth.resetSubtitle')}>
      {!token ? (
        <Alert title={t('auth.linkInvalid')}>
          <Link to="/recuperar" className="underline">{t('auth.requestNewLink')}</Link>
        </Alert>
      ) : reset.isSuccess ? (
        <div role="status" className="grid justify-items-center gap-3 text-center">
          <CircleCheck className="size-10 text-emerald-600" aria-hidden />
          <p className="font-medium text-slate-900">{t('auth.resetDone')}</p>
          <p className="text-muted-foreground text-sm">{t('auth.resetDoneHint')}</p>
          <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
            {t('auth.login')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {reset.error ? (
            <Alert title={errorMessage(reset.error, t)}>
              <Link to="/recuperar" className="underline">{t('auth.requestNewLink')}</Link>
            </Alert>
          ) : null}
          <Field label={t('auth.newPassword')} hint={t('auth.passwordRule')} error={errs.password && t('auth.passwordRule')}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
          </Field>
          <Field label={t('auth.confirmPassword')} error={errs.confirm && t('auth.passwordMismatch')}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('confirm')} />}
          </Field>
          <Button type="submit" loading={reset.isPending} className="w-full">
            {t('auth.resetSubmit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
