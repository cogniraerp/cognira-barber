import { Copy, Crown, KeyRound, Mail, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, UsersRound } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { isApiError } from '@/api/errors';
import {
  useMembersControllerInvite,
  useMembersControllerList,
  useMembersControllerRemove,
  useMembersControllerResend,
  useMembersControllerUpdate,
  useProfileControllerGetPermissions,
  useProfileControllerSetPermissions,
  useRolesControllerCreate,
  useRolesControllerList,
  useRolesControllerRemove,
  useRolesControllerUpdate,
} from '@/api/generated/endpoints';
import type { MemberListDtoItem, PermissionMatrixDtoOutput, ShopRoleListDtoItem } from '@/api/generated/model';
import { Initials } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { MobileCard, Table, Td, Th } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useShop } from '../shop-context';
import { PERM_GROUPS, PERM_LABELS, ROLE_INFO, SENSITIVE, type Role } from './roles';
import { failed, saved, useRefreshShop } from './shared-utils';

type Tab = 'usuarios' | 'roles';

/** Usuarios y permisos: pestañas "Usuarios" (quién entra) y "Roles y permisos" (qué puede hacer cada rol). */
export function MembersPage() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get('seccion') === 'roles' ? 'roles' : 'usuarios';
  const list = useMembersControllerList({ query: {} });
  const counts = (list.data ?? []).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.role]: (acc[m.role] ?? 0) + 1 }), {});
  return (
    <div className="grid gap-4">
      <Tabs
        idBase="equipo"
        label="Usuarios y permisos"
        value={tab}
        onChange={(t) => setSp(t === 'usuarios' ? {} : { seccion: t }, { replace: true })}
        items={[
          { id: 'usuarios', label: 'Usuarios', icon: <UsersRound aria-hidden />, badge: list.data ? <Badge>{list.data.length}</Badge> : undefined },
          { id: 'roles', label: 'Roles y permisos', icon: <ShieldCheck aria-hidden /> },
        ]}
      />
      <TabPanel idBase="equipo" id={tab}>
        {tab === 'usuarios' ? <Users list={list.data} /> : <Roles counts={counts} />}
      </TabPanel>
    </div>
  );
}

// ───────────────────────────── Usuarios ─────────────────────────────

type Member = MemberListDtoItem;

function Users({ list }: { list: Member[] | undefined }) {
  const { t } = useTranslation();
  const shop = useShop();
  const refresh = useRefreshShop();
  const update = useMembersControllerUpdate({ mutation: { onSuccess: async () => { await refresh(); saved(); }, onError: failed } });
  const customRoles = useRolesControllerList({ query: {} });
  const remove = useMembersControllerRemove({ mutation: { onSuccess: () => refresh(), onError: failed } });
  const resend = useMembersControllerResend({ mutation: { onSuccess: (r) => setInviteUrl(r.inviteUrl), onError: failed } });
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const me = shop.role;
  const editable = (m: Member) => m.role !== 'owner' && (me === 'owner' || m.role !== 'admin');

  const assignable = (customRoles.data ?? []).filter((r) => me === 'owner' || r.baseRole !== 'admin');
  const changeRole = (m: Member, value: string) =>
    update.mutate({ id: m.id, data: value.startsWith('custom:') ? { customRoleId: value.slice(7) } : { role: value as 'barber' } });
  const roleCell = (m: Member) =>
    editable(m) ? (
      <Select aria-label={`Rol de ${m.email}`} className="h-9 w-auto min-w-40" value={m.customRole ? `custom:${m.customRole.id}` : m.role} onChange={(e) => changeRole(m, e.target.value)}>
        {/* Con perfil de barbero (recibe reservas) solo se puede tener un rol de nivel Barbero. */}
        <optgroup label="Del sistema">
          {me === 'owner' && <option value="admin" disabled={!!m.staffId}>{t('roles.admin')}{m.staffId ? ' (no: tiene perfil de barbero)' : ''}</option>}
          <option value="receptionist" disabled={!!m.staffId}>{t('roles.receptionist')}{m.staffId ? ' (no: tiene perfil de barbero)' : ''}</option>
          <option value="barber">{t('roles.barber')}</option>
        </optgroup>
        {assignable.length > 0 && (
          <optgroup label="Personalizados">
            {assignable.map((r) => {
              const blocked = !!m.staffId && r.baseRole !== 'barber';
              return <option key={r.id} value={`custom:${r.id}`} disabled={blocked}>{r.name}{blocked ? ' (no: tiene perfil de barbero)' : ''}</option>;
            })}
          </optgroup>
        )}
      </Select>
    ) : m.customRole ? (
      <Badge tone="info">{m.customRole.name}</Badge>
    ) : (
      <Badge tone={m.role === 'owner' ? 'info' : 'neutral'}>{m.role === 'owner' && <Crown className="mr-1 size-3" aria-hidden />}{t(`roles.${m.role}`)}</Badge>
    );
  const statusCell = (m: Member) =>
    m.status === 'invited' ? <Badge tone="warning">Invitación pendiente</Badge> : m.status === 'disabled' ? <Badge tone="danger">Deshabilitado</Badge> : <Badge tone="success">Activo</Badge>;
  const actions = (m: Member) =>
    editable(m) && (
      <span className="flex justify-end gap-1">
        {m.status === 'invited' && <Button variant="outline" size="sm" onClick={() => resend.mutate({ id: m.id })}>Reenviar</Button>}
        {m.status !== 'invited' && (
          <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: m.id, data: { status: m.status === 'active' ? 'disabled' : 'active' } })}>
            {m.status === 'active' ? 'Deshabilitar' : 'Habilitar'}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-9 text-slate-500 hover:text-red-600" onClick={() => remove.mutate({ id: m.id })} aria-label={`Quitar a ${m.email}`}><Trash2 aria-hidden /></Button>
      </span>
    );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Quién entra al panel y con qué rol. El rol define qué puede hacer (pestaña "Roles y permisos").</p>
        <Button onClick={() => setInviting(true)}><Mail aria-hidden /> Invitar usuario</Button>
      </div>
      {!list ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {list.map((m) => (
              <li key={m.id}>
                <MobileCard className="grid gap-3">
                  <span className="flex items-center gap-3">
                    <Initials name={m.fullName ?? m.email ?? '?'} />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium text-slate-900">{m.fullName ?? m.email}</span>
                      <span className="truncate text-sm text-slate-500">{m.email}</span>
                    </span>
                    {statusCell(m)}
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-2">{roleCell(m)}{actions(m)}</span>
                </MobileCard>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <thead><tr><Th>Usuario</Th><Th>Rol</Th><Th>Estado</Th><Th className="text-right">Acciones</Th></tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <span className="flex items-center gap-3">
                        <Initials name={m.fullName ?? m.email ?? '?'} />
                        <span className="grid min-w-0">
                          <span className="truncate font-medium text-slate-900">{m.fullName ?? m.email}</span>
                          <span className="truncate text-xs text-slate-500">{m.email}</span>
                        </span>
                      </span>
                    </Td>
                    <Td>{roleCell(m)}</Td>
                    <Td>{statusCell(m)}</Td>
                    <Td className="text-right">{actions(m)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} onInvited={(url) => { setInviting(false); setInviteUrl(url); }} />}
      {inviteUrl && (
        <Dialog open onClose={() => setInviteUrl(null)} title="Invitación creada" footer={<Button onClick={() => setInviteUrl(null)}>Listo</Button>}>
          <div className="grid gap-3 text-sm">
            <p>Comparte este enlace con la persona invitada (por WhatsApp, por ejemplo). Vence en 7 días y solo funciona con su email.</p>
            <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de invitación" />
            <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(inviteUrl); saved('Enlace copiado'); }}><Copy aria-hidden /> Copiar enlace</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: (url: string) => void }) {
  const { t } = useTranslation();
  const shop = useShop();
  const refresh = useRefreshShop();
  const invite = useMembersControllerInvite({ mutation: { onSuccess: async (r) => { await refresh(); onInvited(r.inviteUrl); } } });
  const [f, setF] = useState({ email: '', role: 'barber', createStaff: true, displayName: '' });
  const customRoles = useRolesControllerList({ query: {} });
  const custom = f.role.startsWith('custom:') ? customRoles.data?.find((r) => r.id === f.role.slice(7)) : undefined;
  const base = custom ? custom.baseRole : f.role;
  const fe = isApiError(invite.error) ? invite.error.fieldErrors() : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate({ data: { email: f.email, role: base as 'barber', ...(custom ? { customRoleId: custom.id } : {}), ...(base === 'barber' && f.createStaff ? { staff: { displayName: f.displayName || f.email.split('@')[0]! } } : {}) } });
  };
  return (
    <Dialog open onClose={onClose} title="Invitar usuario" footer={<><Button variant="ghost" onClick={onClose}>{t('app.cancel')}</Button><Button type="submit" form="invite-form" loading={invite.isPending}>Crear invitación</Button></>}>
      <form id="invite-form" onSubmit={submit} className="grid gap-4">
        {invite.error && !Object.keys(fe).length ? <Alert title={errorMessage(invite.error, t)} /> : null}
        <Field label="Email" error={fe.email}>{(p) => <Input {...p} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Rol" hint={custom ? (custom.description ?? `Basado en ${t(`roles.${custom.baseRole}`)}`) : ROLE_INFO[f.role as Role]?.description}>
          {(p) => (
            <Select {...p} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <optgroup label="Del sistema">
                {shop.role === 'owner' && <option value="admin">{t('roles.admin')}</option>}
                <option value="receptionist">{t('roles.receptionist')}</option>
                <option value="barber">{t('roles.barber')}</option>
              </optgroup>
              {(customRoles.data ?? []).filter((r) => shop.role === 'owner' || r.baseRole !== 'admin').length > 0 && (
                <optgroup label="Personalizados">
                  {(customRoles.data ?? []).filter((r) => shop.role === 'owner' || r.baseRole !== 'admin').map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
                </optgroup>
              )}
            </Select>
          )}
        </Field>
        {base === 'barber' && (
          <>
            <Checkbox label="Crear también su perfil de barbero (recibe reservas)" checked={f.createStaff} onChange={(e) => setF({ ...f, createStaff: e.target.checked })} />
            {f.createStaff && <Field label="Nombre visible">{(p) => <Input {...p} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder="Carlos" />}</Field>}
          </>
        )}
      </form>
    </Dialog>
  );
}

// ───────────────────────────── Roles y permisos ─────────────────────────────

const BASE_LABEL: Record<string, string> = { admin: 'Administrador', receptionist: 'Recepción', barber: 'Barbero' };

function Roles({ counts }: { counts: Record<string, number> }) {
  const { t } = useTranslation();
  const shop = useShop();
  const query = useProfileControllerGetPermissions({ query: {} });
  const custom = useRolesControllerList({ query: {} });
  const [editing, setEditing] = useState<Role | null>(null);
  const [customDialog, setCustomDialog] = useState<{ role?: ShopRoleListDtoItem } | null>(null);
  if (!query.data || !custom.data) return <Skeleton className="h-64" />;
  const m = query.data;
  const total = m.catalog.filter((p) => !p.startsWith('billing.')).length;
  // Los miembros con rol personalizado no cuentan en su rol base.
  const customCount = custom.data.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.baseRole]: (acc[r.baseRole] ?? 0) + r.members }), {});
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Roles del sistema</h3>
          <p className="text-sm text-slate-500">Vienen con la barbería. Puedes ajustar sus permisos, pero no eliminarlos.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li>
            <RoleCard icon={<Crown />} title={t('roles.owner')} description={ROLE_INFO.owner.description} badge={<Badge tone="info">Fijo</Badge>}
              permissions={total} total={total} users={counts.owner ?? 0} footer={<span className="text-slate-400">No se puede limitar</span>} />
          </li>
          {m.roles.map((r) => {
            const role = r.role as Role;
            const n = r.effective.filter((p) => !p.startsWith('billing.')).length;
            const locked = role === 'admin' && shop.role !== 'owner';
            return (
              <li key={role}>
                <RoleCard icon={<KeyRound />} title={t(`roles.${role}`)} description={ROLE_INFO[role].description}
                  badge={Object.keys(r.overrides).length ? <Badge tone="warning">Personalizado</Badge> : <Badge>Predeterminado</Badge>}
                  permissions={n} total={total} users={(counts[role] ?? 0) - (customCount[role] ?? 0)}
                  footer={locked ? <span className="text-slate-400">Solo el dueño puede cambiarlo</span> : <Button size="sm" variant="outline" onClick={() => setEditing(role)}>Editar permisos</Button>} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-900">Roles personalizados</h3>
            <p className="text-sm text-slate-500">Crea roles a tu medida (p. ej. "Cajero" o "Encargado de sede") y asígnalos en la pestaña Usuarios.</p>
          </div>
          <Button onClick={() => setCustomDialog({})}><Plus aria-hidden /> Nuevo rol</Button>
        </div>
        {custom.data.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            Aún no hay roles personalizados. Empieza clonando uno del sistema y ajusta sus permisos.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {custom.data.map((r) => {
              const locked = r.baseRole === 'admin' && shop.role !== 'owner';
              return (
                <li key={r.id}>
                  <RoleCard icon={<Sparkles />} title={r.name} description={r.description ?? `Basado en ${BASE_LABEL[r.baseRole]}.`}
                    badge={<Badge tone="info">Nivel {BASE_LABEL[r.baseRole]}</Badge>} permissions={r.permissions.length} total={total} users={r.members}
                    footer={locked ? <span className="text-slate-400">Solo el dueño puede cambiarlo</span> : <Button size="sm" variant="outline" onClick={() => setCustomDialog({ role: r })}>Editar</Button>} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing && <RoleDialog matrix={m} role={editing} label={t(`roles.${editing}`)} onClose={() => setEditing(null)} />}
      {customDialog && <CustomRoleDialog matrix={m} customRoles={custom.data} role={customDialog.role} onClose={() => setCustomDialog(null)} />}
    </div>
  );
}

function RoleCard({ icon, title, description, badge, permissions, total, users, footer }: {
  icon: ReactNode; title: string; description: string; badge: ReactNode; permissions: number; total: number; users: number; footer: ReactNode;
}) {
  return (
    <div className="grid h-full content-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="grid gap-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="flex min-w-0 items-center gap-2 font-semibold text-slate-900 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-marca-700"><span aria-hidden className="contents">{icon}</span><span className="truncate">{title}</span></h4>
          <span className="shrink-0">{badge}</span>
        </div>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" aria-hidden /><span className="tabular-nums">{permissions}/{total}</span> permisos</span>
          <span className="inline-flex items-center gap-1"><UsersRound className="size-3.5" aria-hidden /><span className="tabular-nums">{Math.max(0, users)}</span> usuario{users === 1 ? '' : 's'}</span>
        </span>
        {footer}
      </div>
    </div>
  );
}

/** Permisos agrupados por módulo con casilla por grupo; reutilizado por roles del sistema y personalizados. */
function PermissionPicker({ catalog, value, onChange, defaults }: {
  catalog: string[]; value: Set<string>; onChange: (v: Set<string>) => void; defaults?: Set<string>;
}) {
  const shop = useShop();
  const mine = new Set<string>(shop.permissions);
  const canGrant = (p: string) => shop.role === 'owner' || mine.has(p) || value.has(p);
  const set = (perms: string[], on: boolean) => {
    const next = new Set(value);
    for (const p of perms) {
      if (!on) next.delete(p);
      else if (canGrant(p)) next.add(p);
    }
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {PERM_GROUPS.map((g) => {
        const perms = g.perms.filter((p) => catalog.includes(p));
        if (!perms.length) return null;
        const n = perms.filter((p) => value.has(p)).length;
        return (
          <fieldset key={g.name} className="overflow-hidden rounded-xl border border-slate-200">
            <legend className="sr-only">{g.name}</legend>
            <label className="flex cursor-pointer items-center gap-3 bg-slate-50/80 px-4 py-2.5">
              <input type="checkbox" className="size-4 accent-marca-700" checked={n === perms.length}
                ref={(el) => { if (el) el.indeterminate = n > 0 && n < perms.length; }} onChange={(e) => set(perms, e.target.checked)} />
              <span className="flex-1 text-sm font-semibold text-slate-900">{g.name}</span>
              <span className="text-xs text-slate-500 tabular-nums">{n}/{perms.length}</span>
            </label>
            <ul className="divide-y divide-slate-100">
              {perms.map((p) => {
                const disabled = !canGrant(p);
                return (
                  <li key={p}>
                    <label className={cn('flex items-center gap-3 px-4 py-2.5 text-sm', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50/70')} title={disabled ? 'No puedes conceder un permiso que tú no tienes' : undefined}>
                      <input type="checkbox" className="size-4 accent-marca-700" checked={value.has(p)} disabled={disabled} onChange={(e) => set([p], e.target.checked)} />
                      <span className="flex-1 text-slate-700">{PERM_LABELS[p] ?? p}</span>
                      {SENSITIVE.has(p) && <span className="text-amber-700" aria-label="sensible" title="Permiso sensible">●</span>}
                      {defaults && value.has(p) !== defaults.has(p) && <Badge tone="warning">cambiado</Badge>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

const visibleCatalog = (catalog: string[]) => catalog.filter((p) => !p.startsWith('billing.'));

/** Ajustar los permisos de un rol del sistema (diferencias contra sus valores por defecto). */
function RoleDialog({ matrix, role, label, onClose }: { matrix: PermissionMatrixDtoOutput; role: Role; label: string; onClose: () => void }) {
  const { t } = useTranslation();
  const shop = useShop();
  const refresh = useRefreshShop();
  const row = matrix.roles.find((r) => r.role === role)!;
  const defaults = new Set<string>(row.defaults);
  const [on, setOn] = useState<Set<string>>(() => new Set<string>(row.effective));
  const save = useProfileControllerSetPermissions({ mutation: { onSuccess: async () => { await refresh(); saved(`Permisos de ${label} guardados`); onClose(); } } });
  const submit = () => {
    const edited: Record<string, boolean> = {};
    for (const p of matrix.catalog) if (on.has(p) !== defaults.has(p)) edited[p] = on.has(p);
    const data = Object.fromEntries(
      matrix.roles.filter((r) => shop.role === 'owner' || r.role !== 'admin').map((r) => [r.role, r.role === role ? edited : r.overrides]),
    );
    save.mutate({ data });
  };
  const catalog = visibleCatalog(matrix.catalog);
  const before = new Set<string>(row.effective);
  const changed = catalog.some((p) => on.has(p) !== before.has(p));
  return (
    <Dialog open onClose={onClose} title={`Permisos del rol: ${label}`} description={ROLE_INFO[role].description} className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setOn(new Set(defaults))}><RotateCcw aria-hidden /> Valores por defecto</Button>
          <Button variant="outline" onClick={onClose}>{t('app.cancel')}</Button>
          <Button loading={save.isPending} disabled={!changed} onClick={submit}>Guardar cambios</Button>
        </>
      }>
      <div className="grid gap-4">
        {save.error ? <Alert title={errorMessage(save.error, t)} /> : null}
        <p className="text-sm text-slate-500"><strong className="text-slate-900 tabular-nums">{[...on].filter((p) => catalog.includes(p)).length}</strong>/{catalog.length} permisos · los marcados con <span className="text-amber-700">●</span> son sensibles.</p>
        <PermissionPicker catalog={catalog} value={on} onChange={setOn} defaults={defaults} />
      </div>
    </Dialog>
  );
}

/** Crear (opcionalmente clonando) o editar un rol personalizado. */
function CustomRoleDialog({ matrix, customRoles, role, onClose }: {
  matrix: PermissionMatrixDtoOutput; customRoles: ShopRoleListDtoItem[]; role?: ShopRoleListDtoItem; onClose: () => void;
}) {
  const { t } = useTranslation();
  const shop = useShop();
  const refresh = useRefreshShop();
  const catalog = visibleCatalog(matrix.catalog);
  const effective = (key: string) => new Set<string>(matrix.roles.find((r) => r.role === key)?.effective ?? []);
  const [f, setF] = useState({
    name: role?.name ?? '',
    description: role?.description ?? '',
    baseRole: (role?.baseRole ?? 'receptionist') as 'admin' | 'receptionist' | 'barber',
  });
  const [on, setOn] = useState<Set<string>>(() => new Set<string>(role ? role.permissions : effective('receptionist')));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = async (msg: string) => { await refresh(); saved(msg); onClose(); };
  const create = useRolesControllerCreate({ mutation: { onSuccess: () => done('Rol creado') } });
  const update = useRolesControllerUpdate({ mutation: { onSuccess: () => done('Rol actualizado') } });
  const remove = useRolesControllerRemove({ mutation: { onSuccess: (r) => done(r.reassigned ? `Rol eliminado; ${r.reassigned} usuario(s) volvieron a su rol base` : 'Rol eliminado') } });
  const m = role ? update : create;
  const err: unknown = m.error ?? remove.error;
  const fe = isApiError(err) ? err.fieldErrors() : {};

  const cloneFrom = (key: string) => {
    if (!key) return;
    if (key.startsWith('custom:')) {
      const src = customRoles.find((r) => r.id === key.slice(7));
      if (src) { setOn(new Set(src.permissions)); setF({ ...f, baseRole: src.baseRole as typeof f.baseRole }); }
    } else {
      setOn(effective(key));
      setF({ ...f, baseRole: key as typeof f.baseRole });
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = { name: f.name.trim(), description: f.description.trim() || null, baseRole: f.baseRole, permissions: [...on] as never[] };
    if (role) update.mutate({ id: role.id, data });
    else create.mutate({ data });
  };

  return (
    <Dialog open onClose={onClose} title={role ? `Editar rol: ${role.name}` : 'Nuevo rol'} className="max-w-2xl"
      description={role ? `${role.members} usuario(s) tienen este rol; los cambios les aplican al instante.` : 'Elige un rol de partida, ponle nombre y ajusta sus permisos.'}
      footer={
        <>
          {role && !confirmDelete && <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden /> Eliminar</Button>}
          {role && confirmDelete && (
            <span className="mr-auto flex items-center gap-2 text-sm">
              ¿Eliminar?{role.members ? ` ${role.members} usuario(s) volverán a ${BASE_LABEL[role.baseRole]}.` : ''}
              <Button size="sm" variant="destructive" loading={remove.isPending} onClick={() => remove.mutate({ id: role.id })}>Sí, eliminar</Button>
            </span>
          )}
          <Button variant="outline" onClick={onClose}>{t('app.cancel')}</Button>
          <Button type="submit" form="custom-role" loading={m.isPending}>{role ? 'Guardar cambios' : 'Crear rol'}</Button>
        </>
      }>
      <form id="custom-role" onSubmit={submit} className="grid gap-4">
        {err && !Object.keys(fe).length ? <Alert title={errorMessage(err, t)} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" error={fe.name}>{(p) => <Input {...p} required minLength={2} maxLength={40} placeholder="Cajero" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Nivel (rol base)" hint="Define a quién puede gestionar y si puede tener perfil de barbero.">
            {(p) => (
              <Select {...p} value={f.baseRole} onChange={(e) => setF({ ...f, baseRole: e.target.value as typeof f.baseRole })}>
                {shop.role === 'owner' && <option value="admin">Administrador</option>}
                <option value="receptionist">Recepción</option>
                <option value="barber">Barbero</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Descripción (opcional)">{(p) => <Input {...p} maxLength={160} placeholder="Cobra en caja y ve la agenda" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        {!role && (
          <Field label="Empezar con los permisos de" hint="Copia sus permisos; luego ajústalos abajo.">
            {(p) => (
              <Select {...p} defaultValue="receptionist" onChange={(e) => cloneFrom(e.target.value)}>
                {matrix.roles.filter((r) => shop.role === 'owner' || r.role !== 'admin').map((r) => <option key={r.role} value={r.role}>{t(`roles.${r.role}`)}</option>)}
                {customRoles.length > 0 && <optgroup label="Personalizados">{customRoles.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}</optgroup>}
              </Select>
            )}
          </Field>
        )}
        <p className="text-sm text-slate-500"><strong className="text-slate-900 tabular-nums">{[...on].filter((p) => catalog.includes(p)).length}</strong>/{catalog.length} permisos · los marcados con <span className="text-amber-700">●</span> son sensibles.</p>
        <PermissionPicker catalog={catalog} value={on} onChange={setOn} />
      </form>
    </Dialog>
  );
}
