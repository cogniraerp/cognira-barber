import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus, CreditCard, LogIn, Pause, Play, Receipt, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useAuditLogsControllerList,
  usePlansControllerList,
  usePlatformBarbershopsControllerChangePlan,
  usePlatformBarbershopsControllerDetail,
  usePlatformBarbershopsControllerExtendTrial,
  usePlatformBarbershopsControllerImpersonate,
  usePlatformBarbershopsControllerReactivate,
  usePlatformBarbershopsControllerRemove,
  usePlatformBarbershopsControllerSuspend,
  usePlatformBillingControllerCreate,
  usePlatformBillingControllerList,
  usePlatformBillingControllerMarkPaid,
  usePlatformBillingControllerVoid,
} from '@/api/generated/endpoints';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { fmtDate, fmtDateTime } from './components/format';
import { InvoiceStatus, ShopStatus, SubStatus } from './components/labels';
import { ReasonDialog } from './components/reason-dialog';

type Modal = null | 'suspend' | 'delete' | 'plan' | 'trial' | 'invoice' | { pay: string } | { void: string };

export function BarbershopDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isSuper = useAuth((s) => s.user?.platformRole === 'superadmin');
  const setImpersonation = useAuth((s) => s.setImpersonation);
  const [modal, setModal] = useState<Modal>(null);

  const detail = usePlatformBarbershopsControllerDetail(id, { query: { retry: false } });
  const plans = usePlansControllerList({ query: {} });
  const invoices = usePlatformBillingControllerList({ barbershopId: id, pageSize: 50 }, { query: { enabled: isSuper } });
  const audit = useAuditLogsControllerList({ barbershopId: id, pageSize: 10 }, { query: {} });

  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/platform') });
  const onDone = async () => {
    setModal(null);
    await refresh();
  };
  const suspend = usePlatformBarbershopsControllerSuspend({ mutation: { onSuccess: onDone } });
  const reactivate = usePlatformBarbershopsControllerReactivate({ mutation: { onSuccess: onDone } });
  const remove = usePlatformBarbershopsControllerRemove({ mutation: { onSuccess: async () => { await refresh(); navigate('/platform/barberias'); } } });
  const impersonate = usePlatformBarbershopsControllerImpersonate();

  if (detail.error) return <div className="p-6"><Alert title={errorMessage(detail.error, t)} /></div>;
  if (!detail.data) return <div className="mx-auto grid max-w-6xl gap-4 p-6"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  const b = detail.data;
  const plan = plans.data?.find((p) => p.id === b.subscription?.plan.id);
  const limits = { ...(plan?.limits ?? {}), ...(b.subscription?.limitsOverride ?? {}) } as Record<string, number | null>;

  const startImpersonation = async () => {
    const r = await impersonate.mutateAsync({ id }).catch(() => null);
    if (!r) return;
    setImpersonation({ token: r.accessToken, barbershopId: id, slug: r.barbershop.slug, name: r.barbershop.name, expiresAt: Date.now() + r.expiresIn * 1000 });
    navigate(`/s/${r.barbershop.slug}`);
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
      <Link to="/platform/barberias" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Barberías</Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{b.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{b.slug}</span><ShopStatus value={b.status} />{b.suspendedAt && <span>desde {fmtDate(b.suspendedAt)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {b.status !== 'deleted' && <Button variant="outline" onClick={() => void startImpersonation()} loading={impersonate.isPending}><LogIn aria-hidden /> Entrar como dueño</Button>}
          {isSuper && b.status === 'suspended' && <Button variant="outline" onClick={() => reactivate.mutate({ id })} loading={reactivate.isPending}><Play aria-hidden /> Reactivar</Button>}
          {isSuper && ['active', 'onboarding'].includes(b.status) && <Button variant="outline" onClick={() => setModal('suspend')}><Pause aria-hidden /> Suspender</Button>}
          {isSuper && b.status !== 'deleted' && <Button variant="ghost" className="text-destructive" onClick={() => setModal('delete')}><Trash2 aria-hidden /> Eliminar</Button>}
        </div>
      </header>
      {impersonate.error ? <Alert title={errorMessage(impersonate.error, t)} /> : null}
      {reactivate.error ? <Alert title={errorMessage(reactivate.error, t)} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Datos</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Dt>Dueño</Dt><Dd>{b.ownerEmail ?? '—'}</Dd>
              <Dt>Razón social</Dt><Dd>{b.legalName ?? '—'}</Dd>
              <Dt>RUC</Dt><Dd>{b.taxId ?? '—'}</Dd>
              <Dt>Teléfono</Dt><Dd>{b.phone ?? '—'}</Dd>
              <Dt>País / zona</Dt><Dd>{b.country} · {b.timezone}</Dd>
              <Dt>Moneda</Dt><Dd>{b.currency}</Dd>
              <Dt>Alta</Dt><Dd>{fmtDate(b.createdAt)}</Dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Uso</CardTitle>{!isSuper && <p className="text-sm text-muted-foreground">Sin acceso a facturación</p>}</CardHeader>
          <CardContent className="grid gap-3">
            <Usage label="Barberos" used={b.usage.staff} max={limits.staff} />
            <Usage label="Sedes" used={b.usage.locations} max={limits.locations} />
            <Usage label="Servicios" used={b.usage.services} max={limits.services} />
            <Usage label="Reservas este mes" used={b.usage.appointmentsThisMonth} max={limits.bookingsPerMonth} />
            <Usage label="WhatsApp este mes" used={b.usage.whatsappThisMonth} max={limits.whatsappPerMonth} />
            <p className="text-sm text-muted-foreground">{b.usage.customers.toLocaleString('es-PE')} clientes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Miembros</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {b.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="grid min-w-0"><span className="truncate">{m.fullName ?? m.email}</span>{m.fullName && <span className="truncate text-xs text-muted-foreground">{m.email}</span>}</span>
                  <span className="flex shrink-0 gap-1"><Badge>{t(`roles.${m.role}`)}</Badge>{m.status !== 'active' && <Badge tone="warning">{m.status === 'invited' ? 'Invitado' : 'Deshabilitado'}</Badge>}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {isSuper && b.subscription && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 sm:flex">
            <CardTitle>Suscripción</CardTitle>
            <div className="flex flex-wrap gap-2">
              {b.subscription.status === 'trialing' && <Button variant="outline" size="sm" onClick={() => setModal('trial')}><CalendarPlus aria-hidden /> Extender prueba</Button>}
              <Button variant="outline" size="sm" onClick={() => setModal('plan')}><CreditCard aria-hidden /> Cambiar plan</Button>
              <Button size="sm" onClick={() => setModal('invoice')}><Receipt aria-hidden /> Emitir factura</Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div><Dt>Plan</Dt><Dd>{b.subscription.plan.name}</Dd></div>
              <div><Dt>Estado</Dt><Dd><SubStatus value={b.subscription.status} /></Dd></div>
              <div><Dt>{b.subscription.status === 'trialing' ? 'Prueba hasta' : 'Periodo hasta'}</Dt><Dd>{fmtDate(b.subscription.trialEndsAt ?? b.subscription.currentPeriodEnd)}</Dd></div>
              <div><Dt>Ciclo / descuento</Dt><Dd>{b.subscription.interval === 'year' ? 'Anual' : 'Mensual'}{b.subscription.discountPercent ? ` · −${b.subscription.discountPercent} %` : ''}</Dd></div>
            </dl>
            {invoices.data && invoices.data.items.length > 0 && (
              <Table>
                <thead><tr><Th>Factura</Th><Th>Periodo</Th><Th>Monto</Th><Th>Estado</Th><Th><span className="sr-only">Acciones</span></Th></tr></thead>
                <tbody>
                  {invoices.data.items.map((i) => (
                    <tr key={i.id}>
                      <Td className="font-mono text-xs">{i.number}</Td>
                      <Td className="whitespace-nowrap">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</Td>
                      <Td className="tabular-nums">{formatMoney(i.amountCents, i.currency)}</Td>
                      <Td><InvoiceStatus value={i.status} />{i.paidAt && <div className="text-xs text-muted-foreground">{fmtDate(i.paidAt)}{i.gatewayRef ? ` · ${i.gatewayRef}` : ''}</div>}</Td>
                      <Td className="text-right whitespace-nowrap">
                        {['open', 'failed', 'draft'].includes(i.status) && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setModal({ pay: i.id })}>Marcar pagada</Button>{' '}
                            <Button size="sm" variant="ghost" onClick={() => setModal({ void: i.id })}>Anular</Button>
                          </>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Actividad reciente</CardTitle></CardHeader>
        <CardContent>
          {!audit.data ? <Skeleton className="h-24" /> : audit.data.items.length === 0 ? <p className="text-sm text-muted-foreground">Sin actividad registrada.</p> : (
            <ul className="grid gap-2 text-sm">
              {audit.data.items.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><code className="text-xs">{a.action}</code>{a.impersonatorUserId && <Badge tone="warning" className="ml-2">impersonación</Badge>}</span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/platform/auditoria?barbershopId=${id}`} className="mt-3 inline-block text-sm underline underline-offset-4">Ver toda la auditoría</Link>
        </CardContent>
      </Card>

      {modal === 'suspend' && (
        <ReasonDialog title="Suspender barbería" description="El equipo de la barbería no podrá operar (solo ver su suscripción). La página pública deja de aceptar reservas." confirmLabel="Suspender" destructive pending={suspend.isPending} error={suspend.error ? errorMessage(suspend.error, t) : null} onClose={() => setModal(null)} onConfirm={(reason) => suspend.mutate({ id, data: { reason } })} />
      )}
      {modal === 'delete' && (
        <ReasonDialog title={`Eliminar ${b.name}`} description="Borrado lógico: se cancela la suscripción, se bloquea el acceso y el slug queda libre. Los datos se conservan." confirmLabel="Eliminar" destructive pending={remove.isPending} error={remove.error ? errorMessage(remove.error, t) : null} onClose={() => setModal(null)} onConfirm={(reason) => remove.mutate({ id, data: { reason } })} />
      )}
      {modal === 'plan' && b.subscription && <ChangePlanDialog id={id} current={b.subscription} plans={plans.data ?? []} onClose={() => setModal(null)} onDone={onDone} />}
      {modal === 'trial' && <ExtendTrialDialog id={id} onClose={() => setModal(null)} onDone={onDone} />}
      {modal === 'invoice' && <CreateInvoiceDialog id={id} onClose={() => setModal(null)} onDone={onDone} />}
      {modal && typeof modal === 'object' && 'pay' in modal && <MarkPaidDialog invoiceId={modal.pay} onClose={() => setModal(null)} onDone={onDone} />}
      {modal && typeof modal === 'object' && 'void' in modal && <VoidInvoice invoiceId={modal.void} onClose={() => setModal(null)} onDone={onDone} />}
    </div>
  );
}

const Dt = ({ children }: { children: ReactNode }) => <dt className="text-muted-foreground">{children}</dt>;
const Dd = ({ children }: { children: ReactNode }) => <dd className="min-w-0 truncate">{children}</dd>;

function Usage({ label, used, max }: { label: string; used: number; max: number | null | undefined }) {
  const limited = typeof max === 'number';
  const raw = limited ? (max > 0 ? used / max : used > 0 ? 2 : 0) : 0;
  const ratio = Math.min(raw, 1);
  // Llegar al límite no es un error (amarillo); pasarse sí (rojo, p. ej. tras bajar de plan).
  const tone = !limited ? 'bg-muted-foreground/40' : raw > 1 ? 'bg-red-600' : raw >= 0.8 ? 'bg-amber-600' : 'bg-[#2a78d6]';
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{used.toLocaleString('es-PE')} / {limited ? max.toLocaleString('es-PE') : '∞'}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limited ? max : undefined}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: limited ? `${ratio * 100}%` : '100%', opacity: limited ? 1 : 0.35 }} />
      </div>
    </div>
  );
}

function ChangePlanDialog({ id, current, plans, onClose, onDone }: { id: string; current: { plan: { code: string }; interval: string; discountPercent: number; limitsOverride: Record<string, unknown> | null }; plans: Array<{ code: string; name: string; priceMonthlyCents: number; currency: string }>; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = usePlatformBarbershopsControllerChangePlan({ mutation: { onSuccess: onDone } });
  const [planCode, setPlan] = useState(current.plan.code);
  const [interval, setInterval] = useState(current.interval as 'month' | 'year');
  const [discount, setDiscount] = useState(String(current.discountPercent));
  const [staffOverride, setStaffOverride] = useState(current.limitsOverride?.staff != null ? String(current.limitsOverride.staff) : '');
  return (
    <Dialog open onClose={onClose} title="Cambiar plan" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={m.isPending} onClick={() => m.mutate({ id, data: { planCode, interval, discountPercent: Number(discount) || 0, limitsOverride: staffOverride ? { staff: Number(staffOverride) } : null } })}>Guardar</Button></>}>
      <div className="grid gap-4">
        {m.error ? <Alert title={errorMessage(m.error, t)} /> : null}
        <Field label="Plan">{(p) => <Select {...p} value={planCode} onChange={(e) => setPlan(e.target.value)}>{plans.map((pl) => <option key={pl.code} value={pl.code}>{pl.name} · {formatMoney(pl.priceMonthlyCents, pl.currency)}/mes</option>)}</Select>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ciclo">{(p) => <Select {...p} value={interval} onChange={(e) => setInterval(e.target.value as 'month' | 'year')}><option value="month">Mensual</option><option value="year">Anual</option></Select>}</Field>
          <Field label="Descuento (%)">{(p) => <Input {...p} type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} />}</Field>
        </div>
        <Field label="Límite de barberos (override)" hint="Vacío = el del plan">{(p) => <Input {...p} type="number" min={0} value={staffOverride} onChange={(e) => setStaffOverride(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function ExtendTrialDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = usePlatformBarbershopsControllerExtendTrial({ mutation: { onSuccess: onDone } });
  const [days, setDays] = useState('7');
  return (
    <Dialog open onClose={onClose} title="Extender prueba" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={m.isPending} onClick={() => m.mutate({ id, data: { days: Number(days) } })}>Extender</Button></>}>
      {m.error ? <Alert title={errorMessage(m.error, t)} /> : null}
      <Field label="Días adicionales" hint="Se suman desde el fin actual de la prueba (1–90).">{(p) => <Input {...p} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
    </Dialog>
  );
}

function CreateInvoiceDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = usePlatformBillingControllerCreate({ mutation: { onSuccess: onDone } });
  const [amount, setAmount] = useState('');
  const [dueInDays, setDue] = useState('7');
  return (
    <Dialog open onClose={onClose} title="Emitir factura" description="Factura el siguiente periodo de la suscripción." footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={m.isPending} onClick={() => m.mutate({ id, data: { amountCents: amount ? Math.round(Number(amount) * 100) : undefined, dueInDays: Number(dueInDays) } })}>Emitir</Button></>}>
      <div className="grid gap-4">
        {m.error ? <Alert title={errorMessage(m.error, t)} /> : null}
        <Field label="Monto (S/)" hint="Vacío = precio del plan con el descuento aplicado">{(p) => <Input {...p} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Vence en (días)">{(p) => <Input {...p} type="number" min={0} max={60} value={dueInDays} onChange={(e) => setDue(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

export function MarkPaidDialog({ invoiceId, onClose, onDone }: { invoiceId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = usePlatformBillingControllerMarkPaid({ mutation: { onSuccess: onDone } });
  const [ref, setRef] = useState('');
  return (
    <Dialog open onClose={onClose} title="Marcar factura como pagada" description="Activa la suscripción y extiende el periodo hasta el fin de la factura." footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={m.isPending} onClick={() => m.mutate({ id: invoiceId, data: { gatewayRef: ref || undefined } })}>Confirmar pago</Button></>}>
      {m.error ? <Alert title={errorMessage(m.error, t)} /> : null}
      <Field label="Referencia del pago" hint="Nº de operación de Yape/Plin, transferencia, etc.">{(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} />}</Field>
    </Dialog>
  );
}

export function VoidInvoice({ invoiceId, onClose, onDone }: { invoiceId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const m = usePlatformBillingControllerVoid({ mutation: { onSuccess: onDone } });
  return <ReasonDialog title="Anular factura" description="La factura queda anulada y no se puede cobrar." confirmLabel="Anular" destructive pending={m.isPending} error={m.error ? errorMessage(m.error, t) : null} onClose={onClose} onConfirm={(reason) => m.mutate({ id: invoiceId, data: { reason } })} />;
}
