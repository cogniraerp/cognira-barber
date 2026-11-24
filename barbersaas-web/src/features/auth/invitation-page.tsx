import { Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, isApiError } from '@/api/errors';
import {
  useAuthControllerRegister,
  useInvitationsControllerAccept,
  useInvitationsControllerGet,
} from '@/api/generated/endpoints';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { useAuth, type SessionUser } from '@/stores/auth';
import { useLogout } from './use-logout';

/**
 * Invitación a una barbería (/invitacion/:token). Sin cuenta: la crea aquí y queda unida a la
 * barbería. Con cuenta: inicia sesión y acepta. El correo debe ser el invitado.
 */
export function InvitationPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const inv = useInvitationsControllerGet(token, { query: { retry: false } });
  const accept = useInvitationsControllerAccept({
    mutation: { onSuccess: (r) => navigate(`/s/${r.slug}`, { replace: true }) },
  });
  const next = encodeURIComponent(`/invitacion/${token}`);

  if (inv.isLoading)
    return (
      <AuthShell title="Invitación">
        <Skeleton className="h-40" />
      </AuthShell>
    );
  if (inv.error || !inv.data)
    return (
      <AuthShell title="Invitación no válida">
        <Alert title="Este enlace no es válido o ya se usó.">
          Si ya creaste tu cuenta, <Link to="/login" className="underline">inicia sesión</Link>. Si no, pide que te envíen un enlace nuevo.
        </Alert>
      </AuthShell>
    );

  const d = inv.data;
  const header = (
    <div className="mb-5 flex items-center gap-3 rounded-xl border bg-slate-50 p-3">
      {d.barbershop.logoUrl ? (
        <img src={d.barbershop.logoUrl} alt="" className="size-11 rounded-lg object-cover" />
      ) : (
        <span className="grid size-11 place-items-center rounded-lg bg-marca-100 text-marca-700"><Store className="size-5" aria-hidden /></span>
      )}
      <div className="grid text-sm">
        <span className="font-semibold text-slate-900">{d.barbershop.name}</span>
        <span className="text-slate-500">Como {t(`roles.${d.role}`)} · para {d.email}</span>
      </div>
    </div>
  );

  if (d.expired)
    return (
      <AuthShell title="La invitación venció">
        {header}
        <Alert title="Este enlace ya no sirve.">Pide que te envíen una invitación nueva.</Alert>
      </AuthShell>
    );

  if (user)
    return (
      <AuthShell title="Únete a la barbería" subtitle={`Entraste como ${user.email}.`}>
        {header}
        <div className="grid gap-3">
          {accept.error ? <AcceptError error={accept.error} /> : null}
          <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate({ token })}>
            Aceptar invitación
          </Button>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      title="Crea tu cuenta"
      subtitle="Elige tu contraseña para entrar al panel."
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to={`/login?next=${next}`} className="text-foreground font-medium underline underline-offset-4">Inicia sesión</Link>
        </>
      }
    >
      {header}
      <SignUpAndAccept token={token} onAccepted={(slug) => navigate(`/s/${slug}`, { replace: true })} loginHref={`/login?next=${next}`} />
    </AuthShell>
  );
}

function AcceptError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const logout = useLogout();
  if (isApiError(error) && error.status === 403)
    return (
      <Alert title="Esta invitación es para otro correo.">
        <button type="button" className="underline" onClick={() => void logout()}>Cierra sesión</button> y entra con el correo invitado.
      </Alert>
    );
  return <Alert title={errorMessage(error, t)} />;
}

function SignUpAndAccept({ token, onAccepted, loginHref }: { token: string; onAccepted: (slug: string) => void; loginHref: string }) {
  const { t } = useTranslation();
  const setSession = useAuth((s) => s.setSession);
  const register = useAuthControllerRegister();
  const accept = useInvitationsControllerAccept();
  const [f, setF] = useState({ fullName: '', email: '', password: '', terms: false });
  const [error, setError] = useState<unknown>(null);
  const pending = register.isPending || accept.isPending;
  const fe = error instanceof ApiError ? error.fieldErrors() : {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const s = await register.mutateAsync({
        data: { fullName: f.fullName, email: f.email, password: f.password, acceptTerms: f.terms as true },
      });
      setSession({ ...s, user: s.user as SessionUser });
      const r = await accept.mutateAsync({ token });
      onAccepted(r.slug);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
      {isApiError(error, 'CONFLICT') && register.isError ? (
        <Alert title="Ese correo ya tiene cuenta.">
          <Link to={loginHref} className="underline">Inicia sesión</Link> para aceptar la invitación.
        </Alert>
      ) : error && !Object.keys(fe).length ? (
        <AcceptError error={error} />
      ) : null}
      <Field label={t('auth.fullName')} error={fe.fullName}>
        {(p) => <Input {...p} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />}
      </Field>
      <Field label={t('auth.email')} error={fe.email} hint="El mismo correo al que llegó la invitación.">
        {(p) => <Input {...p} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
      </Field>
      <Field label={t('auth.password')} error={fe.password} hint={t('auth.passwordRule')}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
      </Field>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" className="mt-0.5 size-4 accent-marca-700" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} />
        <span>
          {t('auth.acceptTermsPrefix')} <Link to="/terminos" target="_blank" className="text-foreground underline">{t('auth.terms')}</Link> {t('auth.and')}{' '}
          <Link to="/privacidad" target="_blank" className="text-foreground underline">{t('auth.privacy')}</Link>.
        </span>
      </label>
      {fe.acceptTerms && <p className="text-destructive text-sm">{fe.acceptTerms}</p>}
      <Button type="submit" className="w-full" loading={pending} disabled={!f.terms}>
        Crear cuenta y unirme
      </Button>
    </form>
  );
}
