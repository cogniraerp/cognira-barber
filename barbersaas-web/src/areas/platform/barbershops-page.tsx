import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  getPlatformBarbershopsControllerListQueryKey,
  usePlansControllerList,
  usePlatformBarbershopsControllerCreate,
  usePlatformBarbershopsControllerList,
} from '@/api/generated/endpoints';
import type { PlatformBarbershopsControllerListParams } from '@/api/generated/model';
import { isApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, PageHeader, Pagination, SearchField, Table, Td, Th } from '@/components/ui/table';
import { useListParams } from '@/lib/use-list-params';
import { errorMessage } from '@/lib/errors';
import { slugify } from '@/lib/slug';
import { useDebounced } from '@/lib/use-debounced';
import { useAuth } from '@/stores/auth';
import { fmtDate } from './components/format';
import { ShopStatus, SubStatus } from './components/labels';

/** Barberías: búsqueda, filtros y paginación en la URL (se pueden compartir y sobreviven al recargar). */
export function BarbershopsPage() {
  const { t } = useTranslation();
  const isSuper = useAuth((s) => s.user?.platformRole === 'superadmin');
  const L = useListParams(20);
  const debouncedQ = useDebounced(L.get('q'), 300);
  const [creating, setCreating] = useState(false);
  const plans = usePlansControllerList({ query: {} });

  const params: PlatformBarbershopsControllerListParams = {
    page: L.page,
    pageSize: L.pageSize,
    q: debouncedQ || undefined,
    status: (L.get('status') as PlatformBarbershopsControllerListParams['status']) || undefined,
    planCode: L.get('plan') || undefined,
    sort: (L.get('sort') as PlatformBarbershopsControllerListParams['sort']) || '-createdAt',
  };
  const list = usePlatformBarbershopsControllerList(params, { query: { placeholderData: keepPreviousData } });

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('nav.barbershops')}
        subtitle={list.data ? `${list.data.total.toLocaleString('es-PE')} barberías` : undefined}
        actions={isSuper && <Button onClick={() => setCreating(true)}><Plus aria-hidden /> Nueva barbería</Button>}
      />

      <FilterBar>
        <SearchField value={L.get('q')} onChange={(e) => L.set({ q: e.target.value })} placeholder="Nombre, slug o email" label="Buscar barberías" />
        <Select aria-label="Estado" value={L.get('status')} onChange={(e) => L.set({ status: e.target.value })}>
          <option value="">Todos los estados</option>
          <option value="onboarding">Configurando</option>
          <option value="active">Activas</option>
          <option value="suspended">Suspendidas</option>
          <option value="deleted">Eliminadas</option>
        </Select>
        {isSuper && (
          <Select aria-label="Plan" value={L.get('plan')} onChange={(e) => L.set({ plan: e.target.value })}>
            <option value="">Todos los planes</option>
            {plans.data?.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
          </Select>
        )}
        <Select aria-label="Orden" value={params.sort} onChange={(e) => L.set({ sort: e.target.value === '-createdAt' ? '' : e.target.value })}>
          <option value="-createdAt">Más recientes</option>
          <option value="createdAt">Más antiguas</option>
          <option value="name">Nombre A–Z</option>
          <option value="-name">Nombre Z–A</option>
        </Select>
      </FilterBar>

      {list.error ? (
        <Alert title={errorMessage(list.error, t)} />
      ) : !list.data ? (
        <Skeleton className="h-80" />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="Sin resultados" description="Prueba con otros filtros." />
      ) : (
        <>
          <Table aria-busy={list.isFetching}>
            <thead>
              <tr><Th>Barbería</Th><Th>Estado</Th>{isSuper && <Th>Plan</Th>}{isSuper && <Th>Suscripción</Th>}<Th>Dueño</Th><Th>Alta</Th></tr>
            </thead>
            <tbody>
              {list.data.items.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link to={b.id} className="font-medium text-slate-900 hover:text-marca-700 hover:underline">{b.name}</Link>
                    <div className="font-mono text-xs text-slate-500">{b.slug}</div>
                  </Td>
                  <Td><ShopStatus value={b.status} /></Td>
                  {isSuper && <Td>{b.subscription?.plan.name ?? '—'}</Td>}
                  {isSuper && (
                    <Td>
                      {b.subscription ? <SubStatus value={b.subscription.status} /> : '—'}
                      {b.subscription?.status === 'trialing' && <div className="text-xs text-muted-foreground">hasta {fmtDate(b.subscription.trialEndsAt)}</div>}
                    </Td>
                  )}
                  <Td className="max-w-48 truncate">{b.ownerEmail ?? '—'}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(b.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}

      {creating && <CreateBarbershopDialog plans={plans.data ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateBarbershopDialog({ plans, onClose }: { plans: Array<{ code: string; name: string; trialDays: number }>; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = usePlatformBarbershopsControllerCreate();
  const [form, setForm] = useState({ name: '', slug: '', ownerEmail: '', planCode: plans[0]?.code ?? '', trialDays: '' });
  const [invite, setInvite] = useState<{ id: string; token: string } | null>(null);
  const slug = form.slug || slugify(form.name);
  const fieldErrors = isApiError(create.error) ? create.error.fieldErrors() : {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await create
      .mutateAsync({ data: { name: form.name, slug, ownerEmail: form.ownerEmail, planCode: form.planCode, trialDays: form.trialDays ? Number(form.trialDays) : undefined } })
      .catch(() => null);
    if (!res) return;
    await qc.invalidateQueries({ queryKey: getPlatformBarbershopsControllerListQueryKey() });
    if (res.inviteToken) setInvite({ id: res.id, token: res.inviteToken });
    else navigate(res.id);
  };

  if (invite) {
    const url = `${window.location.origin}/invitacion/${invite.token}`;
    return (
      <Dialog open onClose={() => navigate(invite.id)} title="Barbería creada" footer={<Button onClick={() => navigate(invite.id)}>Ver barbería</Button>}>
        <div className="grid gap-3 text-sm">
          <p>El dueño todavía no tiene cuenta. Envíale este enlace de invitación (se muestra <strong>una sola vez</strong>; vence en 7 días):</p>
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de invitación" />
          <Button variant="outline" onClick={() => void navigator.clipboard.writeText(url)}>Copiar enlace</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nueva barbería"
      description="Alta manual. Si el email del dueño ya tiene cuenta, queda como owner; si no, se genera una invitación."
      footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button type="submit" form="create-shop" loading={create.isPending}>Crear</Button></>}
    >
      <form id="create-shop" onSubmit={submit} className="grid gap-4">
        {create.error && !fieldErrors.slug ? <Alert title={errorMessage(create.error, t)} /> : null}
        <Field label="Nombre">{(p) => <Input {...p} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Slug" error={fieldErrors.slug} hint="Subdominio y enlace de reservas">{(p) => <Input {...p} value={slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />}</Field>
        <Field label="Email del dueño">{(p) => <Input {...p} type="email" required value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan">{(p) => <Select {...p} value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>{plans.map((pl) => <option key={pl.code} value={pl.code}>{pl.name}</option>)}</Select>}</Field>
          <Field label="Días de prueba" hint={`Por defecto: los del plan`}>{(p) => <Input {...p} type="number" min={0} max={365} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />}</Field>
        </div>
      </form>
    </Dialog>
  );
}
