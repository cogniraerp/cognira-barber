import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Hourglass, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  gatewayAccountsControllerConnect,
  gatewayAccountsControllerRemove,
  gatewayAccountsControllerUpdate,
  gatewayAccountsControllerVerify,
  useChargesControllerList,
  useRefundsControllerList,
  useRefundsControllerRetry,
  useGatewayAccountsControllerOverview,
} from '@/api/generated/endpoints';
import { GatewayManager, type GatewayApi } from '@/components/payments/gateway-manager';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { CHARGE_STATUS } from '../sales/charge-status';
import { useShop } from '../shop-context';
import { Section } from './shared';

const api: GatewayApi = {
  connect: (data) => gatewayAccountsControllerConnect(data),
  update: (id, data) => gatewayAccountsControllerUpdate(id, data),
  verify: (id) => gatewayAccountsControllerVerify(id),
  remove: (id) => gatewayAccountsControllerRemove(id),
  invalidatePrefix: '/v1/shop/payment-',
};

/**
 * Pagos en línea: la barbería conecta SU pasarela (el dinero va directo a su cuenta) para cobrar
 * con link o QR desde la caja. Solo una cuenta está activa a la vez.
 */
export function PaymentsSettings() {
  const q = useGatewayAccountsControllerOverview();
  if (q.error) return <Alert title={errorMessage(q.error, i18n.t)} />;
  if (!q.data) return <Skeleton className="h-80" />;
  return (
    <div className="grid gap-4">
      {!q.data.enabled && (
        <Alert tone="info" title="Tu plan no incluye pagos en línea">
          Cámbiate al plan Pro o Premium para cobrar con link o QR desde la caja.
        </Alert>
      )}
      <Section title="Tu pasarela de pago" description="Cobra con link o QR desde la caja. El dinero va directo a tu cuenta de la pasarela: Cognira no lo toca ni cobra comisión.">
        <GatewayManager data={q.data} api={api} activeLabel="Activa en caja"
          empty={<EmptyState title="Sin pasarela conectada" description="Conecta tu cuenta de Mercado Pago o Izipay (o el simulador para practicar) y aparecerá el método “En línea” al cobrar." />} />
      </Section>
      <RecentCharges />
      <Refunds />
    </div>
  );
}

function RecentCharges() {
  const tz = useShop().barbershop.timezone;
  const q = useChargesControllerList({ page: 1, pageSize: 10 });
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: tz });
  if (!q.data?.items.length) return null;
  return (
    <Section title="Últimos cobros en línea" description="Links y QR generados desde la caja.">
      <Table>
        <thead><tr><Th>Fecha</Th><Th>Concepto</Th><Th className="text-right">Monto</Th><Th>Estado</Th><Th>Venta</Th></tr></thead>
        <tbody>
          {q.data.items.map((c) => {
            const S = CHARGE_STATUS[c.status];
            return (
              <tr key={c.id}>
                <Td className="whitespace-nowrap text-slate-500">{fmt.format(new Date(c.createdAt))}</Td>
                <Td>{c.description}</Td>
                <Td className="text-right font-medium tabular-nums">{formatMoney(c.amountCents)}</Td>
                <Td><Badge tone={S.tone}><S.icon className="mr-1 size-3" aria-hidden />{S.label}</Badge></Td>
                <Td className="font-mono text-sm">{c.sale?.code ?? '—'}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

const REFUND = {
  pending: { label: 'En proceso', icon: Hourglass, tone: 'warning' },
  succeeded: { label: 'Devuelto', icon: CircleCheck, tone: 'success' },
  failed: { label: 'Falló', icon: CircleX, tone: 'danger' },
} as const;

/** Devoluciones por la pasarela (adelantos y ventas anuladas pagadas en línea). */
function Refunds() {
  const qc = useQueryClient();
  const tz = useShop().barbershop.timezone;
  const q = useRefundsControllerList({ page: 1, pageSize: 10 });
  const retry = useRefundsControllerRetry({
    mutation: {
      onSuccess: async (r) => {
        await qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith('/v1/shop/payment-') });
        toast[r.status === 'succeeded' ? 'success' : 'error'](r.status === 'succeeded' ? 'Devolución hecha' : `No se pudo: ${r.error ?? 'error de la pasarela'}`);
      },
    },
  });
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: tz });
  if (!q.data?.items.length) return null;
  return (
    <Section title="Devoluciones" description="Se hacen solas por tu pasarela: adelantos de citas canceladas y ventas anuladas que se pagaron en línea.">
      <Table>
        <thead><tr><Th>Fecha</Th><Th>Motivo</Th><Th className="text-right">Monto</Th><Th>Estado</Th><Th className="text-right">Acción</Th></tr></thead>
        <tbody>
          {q.data.items.map((r) => {
            const S = REFUND[r.status];
            return (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-slate-500">{fmt.format(new Date(r.completedAt ?? r.createdAt))}</Td>
                <Td><div>{r.reason}</div><div className="max-w-80 truncate text-xs text-slate-500">{r.error ?? r.description}</div></Td>
                <Td className="text-right font-medium tabular-nums">{formatMoney(r.amountCents)}</Td>
                <Td><Badge tone={S.tone}><S.icon className="mr-1 size-3" aria-hidden />{S.label}</Badge></Td>
                <Td className="text-right">
                  {r.status !== 'succeeded' ? (
                    <Button size="sm" variant="outline" loading={retry.isPending && retry.variables?.id === r.id} onClick={() => retry.mutate({ id: r.id })}><RefreshCw aria-hidden /> Reintentar</Button>
                  ) : <span className="font-mono text-xs text-slate-400">{r.providerRefundId}</span>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}
