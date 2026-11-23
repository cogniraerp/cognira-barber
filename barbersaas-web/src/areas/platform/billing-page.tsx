import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  platformGatewayControllerConnect,
  platformGatewayControllerRemove,
  platformGatewayControllerUpdate,
  platformGatewayControllerVerify,
  usePlatformBillingControllerList,
  usePlatformGatewayControllerOverview,
} from '@/api/generated/endpoints';
import { GatewayManager, type GatewayApi } from '@/components/payments/gateway-manager';
import type { PlatformBillingControllerListParams } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Alert, EmptyState, Skeleton } from '@/components/ui/misc';
import { FilterBar, PageHeader, Pagination, Table, Td, Th } from '@/components/ui/table';
import { useListParams } from '@/lib/use-list-params';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { MarkPaidDialog, VoidInvoice } from './barbershop-detail-page';
import { fmtDate } from './components/format';
import { InvoiceStatus } from './components/labels';

export function BillingPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const L = useListParams(20);
  const [modal, setModal] = useState<{ pay: string } | { void: string } | null>(null);
  const params: PlatformBillingControllerListParams = {
    page: L.page,
    pageSize: L.pageSize,
    status: (L.get('status') as PlatformBillingControllerListParams['status']) || undefined,
  };
  const list = usePlatformBillingControllerList(params, { query: { placeholderData: keepPreviousData } });
  const done = async () => { setModal(null); await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/v1/platform') }); };

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title={t('nav.billing')} subtitle="Facturas de suscripción: marca las pagadas (Yape, Plin, transferencia) o anúlalas." />
      <PlatformGateway />
      <FilterBar>
        <Select aria-label="Estado" value={L.get('status')} onChange={(e) => L.set({ status: e.target.value })}>
          <option value="">Todas las facturas</option><option value="open">Pendientes</option><option value="paid">Pagadas</option><option value="failed">Fallidas</option><option value="void">Anuladas</option>
        </Select>
      </FilterBar>
      {list.error ? <Alert title={errorMessage(list.error, t)} /> : !list.data ? <Skeleton className="h-64" /> : list.data.items.length === 0 ? <EmptyState title="No hay facturas" description="Se emiten desde el detalle de cada barbería." /> : (
        <>
          <Table>
            <thead><tr><Th>Factura</Th><Th>Barbería</Th><Th>Monto</Th><Th>Vence</Th><Th>Estado</Th><Th className="text-right">Acciones</Th></tr></thead>
            <tbody>
              {list.data.items.map((i) => (
                <tr key={i.id}>
                  <Td className="font-mono text-xs">{i.number}</Td>
                  <Td><Link to={`/platform/barberias/${i.barbershop.id}`} className="font-medium text-slate-900 hover:text-marca-700 hover:underline">{i.barbershop.name}</Link></Td>
                  <Td className="tabular-nums">{formatMoney(i.amountCents, i.currency)}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(i.dueAt)}</Td>
                  <Td><InvoiceStatus value={i.status} /></Td>
                  <Td className="text-right whitespace-nowrap">
                    {['open', 'failed', 'draft'].includes(i.status) && <><Button size="sm" variant="outline" onClick={() => setModal({ pay: i.id })}>Marcar pagada</Button>{' '}<Button size="sm" variant="ghost" onClick={() => setModal({ void: i.id })}>Anular</Button></>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}
      {modal && 'pay' in modal && <MarkPaidDialog invoiceId={modal.pay} onClose={() => setModal(null)} onDone={done} />}
      {modal && 'void' in modal && <VoidInvoice invoiceId={modal.void} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

const gatewayApi: GatewayApi = {
  connect: (data) => platformGatewayControllerConnect(data),
  update: (id, data) => platformGatewayControllerUpdate(id, data),
  verify: (id) => platformGatewayControllerVerify(id),
  remove: (id) => platformGatewayControllerRemove(id),
  invalidatePrefix: '/v1/platform/payment-gateways',
};

/** Pasarela con la que las barberías pagan su suscripción en línea (desde Configuración → Suscripción). */
function PlatformGateway() {
  const q = usePlatformGatewayControllerOverview();
  return (
    <section className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white p-5">
      <div className="grid gap-1">
        <h2 className="font-semibold text-slate-900">Pasarela de cobro</h2>
        <p className="text-sm text-slate-500">Con ella las barberías pagan sus facturas en línea; el pago marca la factura y extiende la suscripción. Sin pasarela, siguen pagando por Yape o transferencia y tú las marcas a mano.</p>
      </div>
      {q.error ? <Alert title={errorMessage(q.error, i18n.t)} /> : !q.data ? <Skeleton className="h-24" /> : (
        <GatewayManager data={q.data} api={gatewayApi} activeLabel="Cobra las suscripciones"
          empty={<p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Sin pasarela: el pago en línea no aparece a las barberías.</p>} />
      )}
    </section>
  );
}
