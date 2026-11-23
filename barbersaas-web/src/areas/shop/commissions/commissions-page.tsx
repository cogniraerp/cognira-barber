import { keepPreviousData } from '@tanstack/react-query';
import { HandCoins, History, ListChecks, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  useCommissionsControllerCreatePayout,
  useCommissionsControllerEntries,
  useCommissionsControllerPayouts,
  useCommissionsControllerSummary,
} from '@/api/generated/endpoints';
import type { CommissionSummaryDtoRowsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { ActionMenu } from '@/components/ui/action-menu';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { MobileCard, PageHeader, Pagination, Table, Td, Th } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useListParams } from '@/lib/use-list-params';
import { cn, formatMoney } from '@/lib/utils';
import { METHOD, METHOD_ORDER, type Method } from '../cash/methods';
import { useShop } from '../shop-context';
import { saved, useRefreshShop } from '../settings/shared-utils';
import { CommissionConfigDialog } from './config-editor';
import { PeriodPicker } from './period-picker';
import { configSummary, isZero, ruleLabel, type Config } from './rule-utils';
import { usePeriod } from './use-period';

type Row = CommissionSummaryDtoRowsItem;

/** Comisiones: resumen por barbero en el período, detalle, liquidar y regla; historial de liquidaciones. */
export function CommissionsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('seccion') === 'liquidaciones' ? 'liquidaciones' : 'resumen';
  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Comisiones" subtitle="Lo que gana cada barbero por lo que atiende y vende, y sus liquidaciones." />
      <Tabs idBase="comisiones" label="Comisiones" value={tab} onChange={(t) => setSp(t === 'resumen' ? {} : { seccion: t }, { replace: true })}
        items={[{ id: 'resumen', label: 'Resumen', icon: <HandCoins aria-hidden /> }, { id: 'liquidaciones', label: 'Liquidaciones', icon: <History aria-hidden /> }]} />
      <TabPanel idBase="comisiones" id={tab}>{tab === 'resumen' ? <Summary /> : <Payouts />}</TabPanel>
    </div>
  );
}

function Summary() {
  const period = usePeriod();
  const { range } = period;
  const q = useCommissionsControllerSummary({ from: range.fromIso, to: range.toIso }, { query: { placeholderData: keepPreviousData } });
  const [dialog, setDialog] = useState<{ type: 'detail' | 'pay' | 'config'; row: Row } | null>(null);
  return (
    <div className="grid gap-4">
      <PeriodPicker period={period} />
      {q.error ? <Alert title={errorMessage(q.error, i18n.t)} /> : !q.data ? <Skeleton className="h-72" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Ganado en el período" value={formatMoney(q.data.totals.earnedCents)} hero />
            <Kpi label="Propinas del período" value={formatMoney(q.data.totals.tipCents)} />
            <Kpi label="Pendiente de liquidar (total)" value={formatMoney(q.data.totals.pendingCents)} />
          </div>
          {q.data.rows.length === 0 ? <EmptyState title="Sin barberos activos" /> : (
            <>
              <ul className="grid gap-2 md:hidden">
                {q.data.rows.map((r) => (
                  <li key={r.staff.id}>
                    <MobileCard className="grid gap-2 text-sm">
                      <span className="flex justify-between gap-2"><span className="font-medium text-slate-900">{r.staff.displayName}</span><span className="font-semibold tabular-nums">{formatMoney(r.earnedCents)}</span></span>
                      <span className="text-slate-500">Pendiente {formatMoney(r.pendingCents)}</span>
                      <span className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'detail', row: r })}>Detalle</Button>
                        {r.pendingCents > 0 && <Button size="sm" onClick={() => setDialog({ type: 'pay', row: r })}>Liquidar</Button>}
                      </span>
                    </MobileCard>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table aria-busy={q.isFetching}>
                  <thead>
                    <tr>
                      <Th>Barbero</Th><Th>Regla</Th><Th className="text-right">Atenciones</Th><Th className="text-right">Base</Th>
                      <Th className="text-right">Comisión</Th><Th className="text-right">Propinas</Th><Th className="text-right">Total período</Th><Th className="text-right">Pendiente</Th><Th className="text-right">Acciones</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.rows.map((r) => (
                      <tr key={r.staff.id}>
                        <Td className="font-medium text-slate-900">{r.staff.displayName}</Td>
                        <Td className="text-slate-500">{isZero(r.config as Config) ? <Badge tone="warning">Sin regla</Badge> : configSummary(r.config as Config)}</Td>
                        <Td className="text-right tabular-nums">{r.servicesCount} serv.{r.productsCount ? ` · ${r.productsCount} prod.` : ''}</Td>
                        <Td className="text-right text-slate-500 tabular-nums">{formatMoney(r.baseCents)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.commissionCents)}</Td>
                        <Td className="text-right tabular-nums">{formatMoney(r.tipCents)}</Td>
                        <Td className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(r.earnedCents)}</Td>
                        <Td className={cn('text-right font-medium tabular-nums', r.pendingCents < 0 ? 'text-red-700' : r.pendingCents > 0 ? 'text-amber-700' : 'text-slate-400')}>{formatMoney(r.pendingCents)}</Td>
                        <Td className="text-right">
                          <span className="flex justify-end gap-1">
                            {r.pendingCents > 0 && <Button size="sm" onClick={() => setDialog({ type: 'pay', row: r })}>Liquidar</Button>}
                            <ActionMenu label={`Más acciones de ${r.staff.displayName}`} actions={[
                              { label: 'Ver detalle', icon: <ListChecks />, onSelect: () => setDialog({ type: 'detail', row: r }) },
                              { label: 'Configurar comisión', icon: <Settings2 />, onSelect: () => setDialog({ type: 'config', row: r }) },
                            ]} />
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
      {dialog?.type === 'detail' && <DetailDialog row={dialog.row} from={range.fromIso} to={range.toIso} onClose={() => setDialog(null)} />}
      {dialog?.type === 'pay' && <PayDialog row={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.type === 'config' && <CommissionConfigDialog staffId={dialog.row.staff.id} staffName={dialog.row.staff.displayName} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Kpi({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className={cn('grid gap-1 rounded-2xl p-5', hero ? 'bg-gradient-to-br from-marca-700 via-marca-900 to-noche text-white' : 'border border-slate-200/80 bg-white')}>
      <span className={cn('text-sm', hero ? 'text-celeste-100' : 'text-slate-500')}>{label}</span>
      <span className={cn('font-semibold tabular-nums', hero ? 'text-3xl' : 'text-2xl text-slate-900')}>{value}</span>
    </div>
  );
}

/** Movimientos de comisión de un barbero en el período (con anulaciones en negativo). */
export function EntriesTable({ items }: { items: Array<{ id: string; earnedAt: string; saleCode: string; description: string; kind: string; baseCents: number; rule: { type: 'percent' | 'fixed'; value: number }; amountCents: number; status: string; isReversal: boolean }> }) {
  const tz = useShop().barbershop.timezone;
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: tz });
  if (!items.length) return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Sin comisiones en este período.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50/80 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <tr><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Venta</th><th className="px-3 py-2 text-left">Detalle</th><th className="px-3 py-2 text-right">Base</th><th className="px-3 py-2 text-right">Regla</th><th className="px-3 py-2 text-right">Comisión</th><th className="px-3 py-2 text-left">Estado</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((e) => (
            <tr key={e.id} className={cn(e.isReversal && 'bg-red-50/40')}>
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmt.format(new Date(e.earnedAt))}</td>
              <td className="px-3 py-2 font-mono text-xs">{e.saleCode}</td>
              <td className="px-3 py-2">{e.kind === 'tip' ? <Badge tone="info">Propina</Badge> : e.description}</td>
              <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{formatMoney(e.baseCents)}</td>
              <td className="px-3 py-2 text-right text-slate-500">{e.kind === 'tip' ? '100 %' : ruleLabel(e.rule)}</td>
              <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', e.amountCents < 0 ? 'text-red-700' : 'text-slate-900')}>{e.amountCents < 0 ? '−' : ''}{formatMoney(Math.abs(e.amountCents))}</td>
              <td className="px-3 py-2">{e.status === 'paid' ? <Badge tone="success">Pagado</Badge> : <Badge tone="warning">Pendiente</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailDialog({ row, from, to, onClose }: { row: Row; from: string; to: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const q = useCommissionsControllerEntries({ staffId: row.staff.id, from, to, page, pageSize: 20 }, { query: { placeholderData: keepPreviousData } });
  return (
    <Dialog open onClose={onClose} title={`Comisiones de ${row.staff.displayName}`} className="max-w-4xl"
      description={`${formatMoney(row.earnedCents)} en el período · pendiente total ${formatMoney(row.pendingCents)}`}>
      {!q.data ? <Skeleton className="h-64" /> : (
        <div className="grid gap-3">
          <EntriesTable items={q.data.items} />
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </div>
      )}
    </Dialog>
  );
}

function PayDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const refresh = useRefreshShop();
  const [f, setF] = useState({ method: 'cash' as Method, note: '', cash: true });
  const pay = useCommissionsControllerCreatePayout({ mutation: { onSuccess: async (p) => { await refresh(); saved(`Liquidado ${formatMoney(p.totalCents)} a ${row.staff.displayName}`); onClose(); } } });
  return (
    <Dialog open onClose={onClose} title={`Liquidar a ${row.staff.displayName}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pay.isPending} onClick={() => pay.mutate({ data: { staffId: row.staff.id, method: f.method, note: f.note.trim() || null, registerInCash: f.method === 'cash' && f.cash } })}>Pagar {formatMoney(row.pendingCents)}</Button></>}>
      <div className="grid gap-4">
        {pay.error ? <Alert title={errorMessage(pay.error, i18n.t)} /> : null}
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Se paga <strong className="text-slate-900">todo lo pendiente hasta hoy</strong>: {formatMoney(row.pendingCents)}. Las comisiones quedan marcadas como pagadas.</p>
        <Field label="Método de pago">
          {(p) => <Select {...p} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as Method })}>{METHOD_ORDER.map((m) => <option key={m} value={m}>{METHOD[m].label}</option>)}</Select>}
        </Field>
        {f.method === 'cash' && <Checkbox label="Registrar la salida en la caja abierta" checked={f.cash} onChange={(e) => setF({ ...f, cash: e.target.checked })} />}
        <Field label="Nota (opcional)">{(p) => <Input {...p} maxLength={300} placeholder="Semana del 2 al 8 de noviembre" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function Payouts() {
  const L = useListParams(20);
  const tz = useShop().barbershop.timezone;
  const q = useCommissionsControllerPayouts({ page: L.page, pageSize: L.pageSize }, { query: { placeholderData: keepPreviousData } });
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  if (q.error) return <Alert title={errorMessage(q.error, i18n.t)} />;
  if (!q.data) return <Skeleton className="h-64" />;
  if (!q.data.items.length) return <EmptyState title="Aún no hay liquidaciones" description="Desde el resumen, toca «Liquidar» para pagar lo pendiente a un barbero." />;
  return (
    <div className="grid gap-4">
      <Table>
        <thead><tr><Th>Fecha</Th><Th>Barbero</Th><Th className="text-right">Monto</Th><Th className="text-right">Movimientos</Th><Th>Método</Th><Th>Nota</Th><Th>Registró</Th></tr></thead>
        <tbody>
          {q.data.items.map((p) => {
            const M = METHOD[p.method as Method];
            return (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{fmt.format(new Date(p.createdAt))}</Td>
                <Td className="font-medium text-slate-900">{p.staff.displayName}</Td>
                <Td className="text-right font-semibold tabular-nums">{formatMoney(p.totalCents)}</Td>
                <Td className="text-right tabular-nums">{p.entriesCount}</Td>
                <Td><span className="inline-flex items-center gap-1.5"><M.icon className="size-4 text-slate-400" aria-hidden />{M.label}</span></Td>
                <Td className="text-slate-500">{p.note ?? '—'}</Td>
                <Td className="text-slate-500">{p.createdBy ?? '—'}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
    </div>
  );
}
