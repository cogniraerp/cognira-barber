import { useQueryClient } from '@tanstack/react-query';
import { Ban, BellRing, CircleAlert, CircleCheck, CirclePause, Clock, Mail, MessageCircle, Play, Receipt, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useCollectionsControllerOverview, useCollectionsControllerRun } from '@/api/generated/endpoints';
import { SubStatus } from '@/components/status-labels';
import { Button } from '@/components/ui/button';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { PageHeader, Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
import { fmtDate, fmtDateTime } from './components/format';

/** Tipos de aviso de cobranza: icono + texto (nunca solo color). */
const NOTICE: Record<string, { label: string; icon: LucideIcon; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  invoice_issued: { label: 'Factura emitida', icon: Receipt, tone: 'info' },
  due_soon: { label: 'Recordatorio', icon: BellRing, tone: 'info' },
  overdue: { label: 'Vencida', icon: Clock, tone: 'warning' },
  final_warning: { label: 'Último aviso', icon: TriangleAlert, tone: 'danger' },
  suspended: { label: 'Suspendida', icon: CirclePause, tone: 'danger' },
  reactivated: { label: 'Reactivada', icon: CircleCheck, tone: 'success' },
};
const SEND: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  sent: { label: 'Enviado', icon: CircleCheck, cls: 'text-emerald-700' },
  pending: { label: 'En cola', icon: Clock, cls: 'text-slate-500' },
  failed: { label: 'Falló', icon: CircleAlert, cls: 'text-red-700' },
  skipped: { label: 'Omitido', icon: Ban, cls: 'text-slate-400' },
};

/**
 * Cobranza de suscripciones: MRR, lo cobrado, lo por vencer y lo vencido; barberías morosas con su
 * fecha de corte y los correos enviados. El worker la ejecuta cada hora; aquí se puede forzar.
 */
export function CollectionsPage() {
  const qc = useQueryClient();
  const q = useCollectionsControllerOverview();
  const run = useCollectionsControllerRun();
  const runNow = () =>
    run.mutate(undefined, {
      onSuccess: async (r) => {
        await qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/v1/platform') });
        const parts = [
          r.invoicesIssued && `${r.invoicesIssued} factura(s) emitida(s)`,
          r.pastDue && `${r.pastDue} morosa(s)`,
          r.suspended && `${r.suspended} suspendida(s)`,
          r.noticesSent && `${r.noticesSent} correo(s) enviado(s)`,
        ].filter(Boolean);
        toast.success(parts.length ? `Cobranza: ${parts.join(', ')}` : 'Cobranza al día: no había nada que hacer');
      },
      onError: (e) => toast.error(errorMessage(e, i18n.t)),
    });

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Cobranza"
        subtitle={q.data ? `Renovación ${q.data.config.renewalLeadDays} días antes · recordatorio ${q.data.config.reminderDays} días antes · ${q.data.config.graceDays} días de gracia antes de suspender` : undefined}
        actions={<Button variant="outline" loading={run.isPending} onClick={runNow}><Play aria-hidden /> Ejecutar ahora</Button>}
      />
      {q.error ? <Alert title={errorMessage(q.error, i18n.t)} /> : !q.data ? <Skeleton className="h-96" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile hero label="Ingreso mensual recurrente" value={formatMoney(q.data.kpis.mrrCents)} hint={`${q.data.kpis.activeSubscriptions} suscripciones pagando`} />
            <Tile label="Cobrado este mes" value={formatMoney(q.data.kpis.collectedMonthCents)} hint={`${q.data.kpis.collectedMonthCount} facturas`} />
            <Tile label="Por vencer" value={formatMoney(q.data.kpis.dueSoonCents)} hint={`${q.data.kpis.dueSoonCount} facturas abiertas`} />
            <Tile label="Vencido" value={formatMoney(q.data.kpis.overdueCents)} hint={`${q.data.kpis.overdueCount} facturas`} tone={q.data.kpis.overdueCount ? 'warning' : undefined} />
            <Tile label="Suspendidas por cobranza" value={String(q.data.kpis.suspendedForBilling)} hint="Se reactivan solas al pagar" tone={q.data.kpis.suspendedForBilling ? 'danger' : undefined} />
          </div>

          <section className="grid gap-3">
            <h2 className="font-semibold text-slate-900">Barberías morosas</h2>
            {q.data.delinquent.length === 0 ? <EmptyState title="Nadie debe nada" description="Todas las facturas vencidas están pagadas." /> : (
              <Table>
                <thead><tr><Th>Barbería</Th><Th>Plan</Th><Th>Suscripción</Th><Th className="text-right">Debe</Th><Th>Vencida</Th><Th>Corte</Th><Th>Último aviso</Th></tr></thead>
                <tbody>
                  {q.data.delinquent.map((d) => {
                    const N = d.lastNotice ? NOTICE[d.lastNotice.kind] : null;
                    const cut = d.barbershop.status === 'suspended';
                    return (
                      <tr key={d.barbershop.id}>
                        <Td><Link to={`/platform/barberias/${d.barbershop.id}`} className="font-medium text-marca-700 hover:underline">{d.barbershop.name}</Link><div className="font-mono text-xs text-slate-400">{d.barbershop.slug}</div></Td>
                        <Td>{d.plan}</Td>
                        <Td><SubStatus value={d.subscriptionStatus} /></Td>
                        <Td className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(d.owedCents)}<div className="text-xs font-normal text-slate-500">{d.invoices} {d.invoices === 1 ? 'factura' : 'facturas'}</div></Td>
                        <Td className="whitespace-nowrap">hace {d.daysOverdue} {d.daysOverdue === 1 ? 'día' : 'días'}<div className="text-xs text-slate-500">{fmtDate(d.oldestDueAt)}</div></Td>
                        <Td className={cn('whitespace-nowrap', cut && 'font-medium text-red-700')}>{cut ? (d.barbershop.suspendedReason === 'manual' ? 'Suspendida (manual)' : 'Suspendida') : fmtDate(d.suspendsAt)}</Td>
                        <Td>{N ? <Badge tone={N.tone}><N.icon className="mr-1 size-3" aria-hidden />{N.label}</Badge> : <span className="text-slate-400">—</span>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="font-semibold text-slate-900">Últimos avisos por correo</h2>
            {q.data.notices.length === 0 ? <EmptyState title="Sin avisos todavía" /> : (
              <Table>
                <thead><tr><Th>Fecha</Th><Th>Barbería</Th><Th>Aviso</Th><Th>Factura</Th><Th>Canal</Th><Th>Para</Th><Th>Envío</Th></tr></thead>
                <tbody>
                  {q.data.notices.map((n) => {
                    const N = NOTICE[n.kind]!;
                    const S = SEND[n.status] ?? SEND.pending!;
                    return (
                      <tr key={n.id}>
                        <Td className="whitespace-nowrap text-slate-500">{fmtDateTime(n.sentAt ?? n.createdAt)}</Td>
                        <Td>{n.barbershop.name}</Td>
                        <Td><Badge tone={N.tone}><N.icon className="mr-1 size-3" aria-hidden />{N.label}</Badge></Td>
                        <Td className="font-mono text-xs">{n.invoiceNumber}</Td>
                        <Td className="whitespace-nowrap">{n.channel === 'whatsapp' ? <span className="flex items-center gap-1"><MessageCircle className="size-3.5 text-emerald-700" aria-hidden />WhatsApp</span> : <span className="flex items-center gap-1"><Mail className="size-3.5 text-slate-500" aria-hidden />Correo</span>}</Td>
                        <Td className="max-w-56 truncate text-slate-500" title={n.recipients.join(', ')}>{n.recipients.join(', ') || '—'}</Td>
                        <Td title={n.error ?? undefined}><span className={cn('flex items-center gap-1 text-sm', S.cls)}><S.icon className="size-3.5" aria-hidden />{S.label}</span></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint, hero, tone }: { label: string; value: string; hint?: string; hero?: boolean; tone?: 'warning' | 'danger' }) {
  return (
    <div className={cn('grid content-start gap-1 rounded-2xl p-4', hero ? 'bg-gradient-to-br from-marca-700 via-marca-900 to-noche text-white' : 'border border-slate-200/80 bg-white')}>
      <span className={cn('text-sm', hero ? 'text-celeste-100' : 'text-slate-500')}>{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums', !hero && (tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-slate-900'))}>{value}</span>
      {hint && <span className={cn('text-xs', hero ? 'text-celeste-100/80' : 'text-slate-500')}>{hint}</span>}
    </div>
  );
}
