import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import { useAuthControllerRegister } from '@/api/generated/endpoints';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { useAuth, type SessionUser } from '@/stores/auth';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Mínimo 2 caracteres'),
  email: z.email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  acceptTerms: z.literal(true, { message: 'Debes aceptar para crear tu cuenta' }),
});
type Form = z.input<typeof schema>;

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const register = useAuthControllerRegister();
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', email: '', password: '', acceptTerms: false as unknown as true },
  });
  const fieldErrors = isApiError(register.error) ? register.error.fieldErrors() : {};
  const err = (k: keyof Form) => form.formState.errors[k]?.message ?? fieldErrors[k];

  const onSubmit = form.handleSubmit(async (data) => {
    const res = await register.mutateAsync({ data }).catch(() => null);
    if (!res) return;
    setSession({ ...res, user: res.user as SessionUser });
    navigate('/cuenta', { replace: true });
  });

  return (
    <AuthShell
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="text-foreground font-medium underline underline-offset-4">
            {t('auth.login')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {register.error && !isApiError(register.error, 'VALIDATION_FAILED') ? (
          <Alert title={errorMessage(register.error, t)} />
        ) : null}
        <Field label={t('auth.fullName')} error={err('fullName')}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} />}
        </Field>
        <Field label={t('auth.email')} error={err('email')}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </Field>
        <Field label={t('auth.password')} error={err('password')}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <div className="grid gap-1">
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" className="mt-0.5 size-4 accent-marca-700" {...form.register('acceptTerms')} />
            <span>
              {t('auth.acceptTermsPrefix')}{' '}
              <Link to="/terminos" target="_blank" className="text-foreground underline underline-offset-4">{t('auth.terms')}</Link>{' '}
              {t('auth.and')}{' '}
              <Link to="/privacidad" target="_blank" className="text-foreground underline underline-offset-4">{t('auth.privacy')}</Link>.
            </span>
          </label>
          {err('acceptTerms') && <p className="text-destructive text-sm">{err('acceptTerms')}</p>}
        </div>
        <Button type="submit" loading={register.isPending} className="w-full">
          {t('auth.register')}
        </Button>
      </form>
    </AuthShell>
  );
}
