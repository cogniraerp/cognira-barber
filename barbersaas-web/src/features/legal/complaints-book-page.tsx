import { Link, useParams } from 'react-router';
import {
  publicComplaintsControllerCreateForPlatform,
  publicComplaintsControllerCreateForShop,
  usePublicComplaintsControllerLegal,
  usePublicComplaintsControllerShopBook,
} from '@/api/generated/endpoints';
import { NotFound } from '@/components/layout/route-error';
import { Skeleton } from '@/components/ui/misc';
import { env } from '@/lib/env';
import { currentHost } from '@/lib/tenant';
import { ComplaintForm } from './complaint-form';
import { LegalShell } from './legal-shell';

const SUBTITLE = 'Conforme al Código de Protección y Defensa del Consumidor, contamos con un Libro de Reclamaciones a tu disposición.';

/** Libro de Reclamaciones de Cognira (para las barberías que contratan el servicio). */
export function PlatformComplaintsBookPage() {
  const legal = usePublicComplaintsControllerLegal({ query: { staleTime: 3_600_000 } });
  return (
    <LegalShell title="Libro de Reclamaciones" subtitle={SUBTITLE}>
      {legal.data ? (
        <ComplaintForm provider={legal.data} submit={(data) => publicComplaintsControllerCreateForPlatform(data)} />
      ) : (
        <Skeleton className="h-96" />
      )}
    </LegalShell>
  );
}

/** Libro de Reclamaciones de una barbería ({slug}.dominio/libro-reclamaciones o /b/:slug/libro-reclamaciones). */
export function ShopComplaintsBookPage() {
  const params = useParams();
  const host = currentHost(env.rootDomain);
  const slug = host.kind === 'shop-public' ? host.slug : (params.slug ?? '');
  const base = host.kind === 'shop-public' ? '' : `/b/${slug}`;
  const book = usePublicComplaintsControllerShopBook(slug, { query: { retry: false, staleTime: 60_000 } });
  if (book.error) return <NotFound />;
  return (
    <LegalShell
      title="Libro de Reclamaciones"
      subtitle={SUBTITLE}
      bookHref={`${base}/libro-reclamaciones`}
      brand={<Link to={base || '/'} className="font-semibold text-slate-900">{book.data?.tradeName ?? ' '}</Link>}
    >
      {book.data ? (
        <ComplaintForm provider={book.data} submit={(data) => publicComplaintsControllerCreateForShop(slug, data)} />
      ) : (
        <Skeleton className="h-96" />
      )}
    </LegalShell>
  );
}
