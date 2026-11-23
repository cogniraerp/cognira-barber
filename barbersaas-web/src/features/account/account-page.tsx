import { ChevronRight, LogOut, Plus, ShieldCheck, Store } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/brand';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  useMeControllerBarbershops,
  useMeControllerCreateBarbershop,
  usePublicSlugControllerAvailability,
} from '@/api/generated/endpoints';
import { EmailVerifyBanner } from '@/components/account/email-verify-banner';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { useLogout } from '@/features/auth/use-logout';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/errors';
import { slugify } from '@/lib/slug';
import { useDebounced } from '@/lib/use-debounced';
import { useAuth } from '@/stores/auth';

/** "Mis barberías": selector de barbería + alta self-service. */
export function AccountPage() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user)!;
  const logout = useLogout();
  const shops = useMeControllerBarbershops({ query: {} });
  const [creating, setCreating] = useState(false);

  return (
    <main className="mx-auto grid min-h-dvh max-w-2xl content-start gap-6 p-4 sm:p-8">
      <div className="flex items-center gap-2">
        <BrandMark className="size-8" />
        <Wordmark className="text-sm" />
      </div>
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{t('account.title')}</h1>
          <p className="text-muted-foreground text-sm">
            {user.fullName} · {user.email}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOut aria-hidden /> <span className="sr-only sm:not-sr-only">{t('app.logout')}</span>
          </Button>
        </div>
      </header>

      <EmailVerifyBanner className="rounded-xl" />

      {user.platformRole && (
        <Link to="/platform" className={buttonVariants({ variant: 'outline', className: 'justify-between' })}>
          <span className="flex items-center gap-2">
            <ShieldCheck aria-hidden /> {t('account.platform')}
          </span>
          <ChevronRight aria-hidden />
        </Link>
      )}

      <section aria-labelledby="shops" className="grid gap-3">
        <h2 id="shops" className="sr-only">
          {t('account.title')}
        </h2>
        {shops.isPending ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : shops.error ? (
          <Alert title={errorMessage(shops.error, t)} />
        ) : shops.data.length === 0 && !creating ? (
          <EmptyState
            title={t('account.empty')}
            description={t('account.emptyHint')}
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> {t('account.create')}
              </Button>
            }
          />
        ) : (
          shops.data.map((s) => (
            <Link
              key={s.id}
              to={`/s/${s.slug}`}
              className="group bg-card hover:bg-muted/50 flex items-center gap-3 rounded-xl border p-4 shadow-sm transition-colors"
            >
              {s.logoUrl ? (
                <img src={s.logoUrl} alt="" className="size-10 rounded-lg object-cover" />
              ) : (
                <span className="bg-muted grid size-10 place-items-center rounded-lg">
                  <Store className="size-5" aria-hidden />
                </span>
              )}
              <span className="grid flex-1 gap-0.5">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  {t(`roles.${s.role}`)}
                  <Badge
                    tone={s.status === 'active' ? 'success' : s.status === 'suspended' ? 'danger' : 'warning'}
                  >
                    {t(`status.${s.status}`)}
                  </Badge>
                </span>
              </span>
              <ChevronRight
                className="text-muted-foreground size-5 group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          ))
        )}
      </section>

      {creating ? (
        <CreateShop onCancel={() => setCreating(false)} />
      ) : shops.data?.length ? (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden /> {t('account.create')}
        </Button>
      ) : null}
    </main>
  );
}

function CreateShop({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touchedSlug, setTouchedSlug] = useState(false);
  const effectiveSlug = touchedSlug ? slug : slugify(name);
  const debounced = useDebounced(effectiveSlug, 350);
  const availability = usePublicSlugControllerAvailability(debounced, {
    query: { enabled: debounced.length >= 3 },
  });
  const create = useMeControllerCreateBarbershop();
  const a = debounced === effectiveSlug ? availability.data : undefined;
  const slugError =
    a && !a.available
      ? a.reason === 'taken'
        ? t('account.slugTaken', { suggestion: a.suggestion })
        : a.reason === 'reserved'
          ? t('account.slugReserved')
          : t('account.slugInvalid')
      : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await create
      .mutateAsync({ data: { name, slug: effectiveSlug || undefined } })
      .catch(() => null);
    if (res) navigate(`/s/${res.slug}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.create')}</CardTitle>
        <CardDescription>{t('auth.registerSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          {create.error ? <Alert title={errorMessage(create.error, t)} /> : null}
          <Field label={t('account.name')}>
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoFocus
              />
            )}
          </Field>
          <Field
            label={t('account.slug')}
            error={slugError}
            hint={
              effectiveSlug ? t('account.slugHint', { url: `${effectiveSlug}.${env.rootDomain}` }) : undefined
            }
          >
            {(p) => (
              <Input
                {...p}
                value={effectiveSlug}
                onChange={(e) => {
                  setTouchedSlug(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                pattern="[a-z0-9\-]{3,48}"
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              {t('app.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim() || Boolean(slugError)}>
              {t('account.create')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
