import { useQueryClient, useQuery } from '@tanstack/react-query';
import { CircleCheck, CreditCard, ExternalLink, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useState } from 'react';
import { useShopBillingControllerBilling, useShopBillingControllerCharge, useShopBillingControllerPay, useShopBillingControllerRefresh } from '@/api/generated/endpoints';
import type { InvoiceChargeDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { MobileCard, Table, Td, Th } from '@/components/ui/table';
import { InvoiceStatus, SubStatus } from '@/components/status-labels';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { CHARGE_STATUS } from '../sales/charge-status';
import { useCan } from '../shop-context';
import { PlanPicker } from './plan-picker';
import { Section } from './shared';
import { failed } from './shared-utils';

const fmtDate = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';

/** Mi suscripción a Cognira Barber: plan, estado, facturas y pago en línea. */
export function SubscriptionSettings() {
  const q = useShopBillingControllerBilling();
  const canPay = useCan()('billing.manage');
  const pay = useShopBillingControllerPay();
  const [charge, setCharge] = useState<InvoiceChargeDto | null>(null);
  if (q.error) return <Alert title={errorMessage(q.error, i18n.t)} />;
  if (!q.data) return <Skeleton className="h-80" />;
  const { subscription: s, invoices, onlinePay } = q.data;
  const price = s.interval === 'year' ? s.plan.priceYearlyCents : s.plan.priceMonthlyCents;
  const net = Math.round((price * (100 - s.discountPercent)) / 100);
  const due = invoices.filter((i) => i.status === 'open' || i.status === 'failed');
  const startPay = (id: string) => pay.mutate({ id }, { onSuccess: setCharge, onError: failed });

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-2xl bg-gradient-to-br from-marca-700 via-marca-900 to-noche p-5 text-white sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="grid gap-1">
          <span className="text-sm text-celeste-100">Tu plan</span>
          <span className="flex flex-wrap items-center gap-2 text-2xl font-semibold">Cognira Barber {s.plan.name} <SubStatus value={s.status} /></span>
          <span className="text-sm text-celeste-100">
            {s.status === 'trialing' && s.trialEndsAt ? `Prueba gratis hasta el ${fmtDate(s.trialEndsAt)}` : s.currentPeriodEnd ? `Pagado hasta el ${fmtDate(s.currentPeriodEnd)}` : 'Sin periodo pagado'}
          </span>
        </div>
        <div className="grid justify-items-start gap-0.5 sm:justify-items-end">
          <span className="text-3xl font-semibold tabular-nums">{formatMoney(net)}</span>
          <span className="text-sm text-celeste-100">por {s.interval === 'year' ? 'año' : 'mes'}{s.discountPercent ? ` · ${s.discountPercent} % de descuento` : ''}</span>
        </div>
      </section>

      {due.length > 0 && (
        <Alert tone="info" title={`Tienes ${due.length === 1 ? 'una factura pendiente' : `${due.length} facturas pendientes`} por ${formatMoney(due.reduce((n, i) => n + i.amountCents, 0))}`}>
          {onlinePay
            ? canPay ? 'Págala en línea con tarjeta o Yape desde la tabla de abajo.' : 'Pídele al dueño que la pague desde esta pantalla.'
            : 'Paga por Yape o transferencia y envíanos el comprobante; la marcaremos como pagada.'}
        </Alert>
      )}

      <PlanPicker canManage={canPay} />
      <Section title="Facturas" description="Lo que te hemos facturado por tu suscripción.">
        {invoices.length === 0 ? <EmptyState title="Aún no tienes facturas" description="Aparecerán aquí al terminar tu periodo de prueba." /> : (
          <>
            <ul className="grid gap-2 md:hidden">
              {invoices.map((i) => (
                <li key={i.id}>
                  <MobileCard className="grid gap-2 text-sm">
                    <span className="flex items-center justify-between gap-2"><span className="font-mono font-medium">{i.number}</span><InvoiceStatus value={i.status} /></span>
                    <span className="flex justify-between text-slate-500"><span>{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</span><span className="font-semibold text-slate-900 tabular-nums">{formatMoney(i.amountCents)}</span></span>
                    {onlinePay && canPay && (i.status === 'open' || i.status === 'failed') && <Button size="sm" loading={pay.isPending && pay.variables?.id === i.id} onClick={() => startPay(i.id)}><CreditCard aria-hidden /> Pagar en línea</Button>}
                  </MobileCard>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <thead><tr><Th>Nº</Th><Th>Periodo</Th><Th>Vence</Th><Th className="text-right">Monto</Th><Th>Estado</Th><Th className="text-right">Acción</Th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <Td className="whitespace-nowrap font-mono">{i.number}</Td>
                      <Td className="whitespace-nowrap">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</Td>
                      <Td className="whitespace-nowrap text-slate-500">{i.status === 'paid' ? `Pagada el ${fmtDate(i.paidAt)}` : fmtDate(i.dueAt)}</Td>
                      <Td className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(i.amountCents)}</Td>
                      <Td><InvoiceStatus value={i.status} /></Td>
                      <Td className="text-right">
                        {onlinePay && canPay && (i.status === 'open' || i.status === 'failed') ? (
                          <Button size="sm" loading={pay.isPending && pay.variables?.id === i.id} onClick={() => startPay(i.id)}><CreditCard aria-hidden /> Pagar en línea</Button>
                        ) : <span className="text-slate-400">—</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Section>
      {charge && <InvoicePayDialog initial={charge} onClose={() => setCharge(null)} />}
    </div>
  );
}

/** Pago de factura: abrir la pasarela (o escanear el QR) y esperar la confirmación. */
function InvoicePayDialog({ initial, onClose }: { initial: InvoiceChargeDto; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useShopBillingControllerCharge(initial.id, {
    query: { initialData: initial, refetchInterval: (s) => (s.state.data?.status === 'pending' ? 4000 : false) },
  });
  const refresh = useShopBillingControllerRefresh();
  const c = q.data ?? initial;
  const url = c.checkoutUrl ?? '';
  const qr = useQuery({ queryKey: ['qr', url], queryFn: () => QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: '#060b1e' } }), enabled: !!url, staleTime: Infinity });
  const S = CHARGE_STATUS[c.status];
  const close = async () => { await qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/v1/shop') }); onClose(); };
  return (
    <Dialog open onClose={close} title={`Pagar ${formatMoney(c.amountCents)}`} className="max-w-md"
      description={c.status === 'pending' ? 'Se abre la página segura de la pasarela. Al terminar, vuelve aquí: la factura se marca sola.' : undefined}
      footer={c.status === 'pending'
        ? <Button variant="outline" loading={refresh.isPending} onClick={() => refresh.mutate({ id: c.id }, { onSuccess: () => q.refetch(), onError: failed })}><RefreshCw aria-hidden /> Ya pagué, verificar</Button>
        : <Button onClick={close}>Listo</Button>}>
      <div className="grid justify-items-center gap-4">
        <Badge tone={S.tone} className="text-sm"><S.icon className="mr-1 size-4" aria-hidden />{c.status === 'pending' ? 'Esperando el pago' : S.label}</Badge>
        {c.status === 'paid' ? (
          <div className="grid justify-items-center gap-2 py-4 text-center">
            <CircleCheck className="size-16 text-emerald-600" aria-hidden />
            <p className="text-lg font-semibold text-slate-900">¡Gracias! Tu factura quedó pagada</p>
            {c.providerPaymentId && <p className="font-mono text-sm text-slate-500">Operación {c.providerPaymentId}</p>}
          </div>
        ) : c.status === 'pending' ? (
          <>
            <a href={url} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'lg', className: 'w-full' })}><ExternalLink aria-hidden /> Ir a pagar</a>
            <span className="text-xs text-slate-500">o escanea desde tu celular</span>
            {qr.data && <img src={qr.data} alt="Código QR para pagar la factura" className="size-44 rounded-xl border border-slate-200 bg-white p-2" />}
          </>
        ) : (
          <p className="py-4 text-center text-slate-600">Este intento de pago ya no está disponible. Vuelve a pulsar “Pagar en línea”.</p>
        )}
      </div>
    </Dialog>
  );
}
