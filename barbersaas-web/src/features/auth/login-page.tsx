import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useAuthControllerLogin } from '@/api/generated/endpoints';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { safeNext } from '@/lib/safe-next';
import { useAuth, type SessionUser } from '@/stores/auth';

const schema = z.object({ email: z.email(), password: z.string().min(1) });
type Form = z.infer<typeof schema>;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, setSession } = useAuth();
  const login = useAuthControllerLogin();
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (user)
    return (
      <Navigate to={safeNext(params.get('next')) ?? (user.platformRole ? '/platform' : '/cuenta')} replace />
    );

  const onSubmit = form.handleSubmit(async (data) => {
    const res = await login.mutateAsync({ data }).catch(() => null);
    if (!res) return;
    setSession({ ...res, user: res.user as SessionUser });
    navigate(safeNext(params.get('next')) ?? (res.user.platformRole ? '/platform' : '/cuenta'), {
      replace: true,
    });
  });

  return (
    <AuthShell
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/registro" className="text-foreground font-medium underline underline-offset-4">
            {t('auth.register')}
          </Link>
          <p className="mt-3 text-xs">{t('auth.demoHint')}</p>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {login.error ? <Alert title={errorMessage(login.error, t)} /> : null}
        <Field label={t('auth.email')} error={form.formState.errors.email && t('errors.VALIDATION_FAILED')}>
          {(p) => (
            <Input {...p} type="email" autoComplete="email" inputMode="email" {...form.register('email')} />
          )}
        </Field>
        <Field
          label={t('auth.password')}
          error={form.formState.errors.password && t('errors.VALIDATION_FAILED')}
        >
          {(p) => (
            <Input {...p} type="password" autoComplete="current-password" {...form.register('password')} />
          )}
        </Field>
        <Button type="submit" loading={login.isPending} className="w-full">
          {t('auth.login')}
        </Button>
        <Link to="/recuperar" className="text-muted-foreground justify-self-center text-sm underline underline-offset-4">
          {t('auth.forgotLink')}
        </Link>
      </form>
    </AuthShell>
  );
}
