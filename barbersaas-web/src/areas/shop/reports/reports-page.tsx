import { keepPreviousData } from '@tanstack/react-query';
import { Boxes, CreditCard, Download, Scissors, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { reportsControllerExport, useLocationsControllerList, useReportsControllerOverview } from '@/api/generated/endpoints';
import type { ReportOverviewDtoOutput, ReportsControllerExportSection } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Alert, EmptyState, Skeleton } from '@/components/ui/misc';
import { PageHeader, Table, Td, Th } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { downloadCsv } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';
import { METHOD, type Method } from '../cash/methods';
import { PeriodPicker } from '../commissions/period-picker';
import { usePeriod } from '../commissions/use-period';
import { Kpi, Meter } from './kpi';
import { fmtHours, fmtPct, ratio } from './report-utils';
import { RevenueChart } from './revenue-chart';

type Section = 'barberos' | 'servicios' | 'productos' | 'metodos';
const SECTIONS: Array<{ id: Section; label: string; icon: ReactNode; csv: ReportsControllerExportSection }> = [
  { id: 'barberos', label: 'Barberos', icon: <UserRound aria-hidden />, csv: 'staff' },
  { id: 'servicios', label: 'Servicios', icon: <Scissors aria-hidden />, csv: 'services' },
  { id: 'productos', label: 'Productos', icon: <Boxes aria-hidden />, csv: 'products' },
  { id: 'metodos', label: 'Métodos de pago', icon: <CreditCard aria-hidden />, csv: 'methods' },
];

/**
 * Reportes: KPIs del período con variación frente al anterior, ingresos por día y desgloses
 * por barbero, servicio, producto y método de pago; cada uno exportable a CSV (Excel).
 */
export function ReportsPage() {
  const period = usePeriod();
  const { L, range } = period;
  const locations = useLocationsControllerList({ query: {} });
  const sede = L.get('sede') || undefined;
  const params = { from: range.from, to: range.toInclusive, locationId: sede };
  const q = useReportsControllerOverview(params, { query: { placeholderData: keepPreviousData } });
  const raw = L.get('seccion') as Section;
  const section: Section = SECTIONS.some((s) => s.id === raw) ? raw : 'barberos';
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);

  const exportCsv = async (csv: ReportsControllerExportSection) => {
    setExporting(csv);
    setExportError(null);
    try {
      const text = (await reportsControllerExport({ ...params, section: csv })) as unknown as string;
      downloadCsv(`reporte-${csv}-${range.from}_${range.toInclusive}.csv`, text);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(null);
    }
  };
  const csvButton = (csv: ReportsControllerExportSection) => (
    <Button variant="outline" size="sm" loading={exporting === csv} onClick={() => exportCsv(csv)} aria-label={`Exportar ${csv === 'days' ? 'ingresos por día' : SECTIONS.find((s) => s.csv === csv)!.label.toLowerCase()} a CSV`}><Download aria-hidden /> CSV</Button>
  );
  const data = q.data;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Reportes" subtitle="Cómo va el negocio: ventas, agenda y clientes del período, comparado con el anterior." />
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker period={period} />
        {(locations.data?.length ?? 0) > 1 && (
          <Select aria-label="Sede" className="w-auto min-w-40" value={sede ?? ''} onChange={(e) => L.set({ sede: e.target.value || null })}>
            <option value="">Todas las sedes</option>
            {locations.data!.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
      </div>
      {exportError ? <Alert title={errorMessage(exportError, i18n.t)} /> : null}

      {q.error ? <Alert title={errorMessage(q.error, i18n.t)} /> : !data ? <Skeleton className="h-[32rem]" /> : (
        <div className="grid min-w-0 grid-cols-1 gap-4" aria-busy={q.isFetching}>
          <Kpis data={data} />
          {data.deposits.count > 0 && <Deposits d={data.deposits} />}
          <RevenueChart data={data.byDay} actions={csvButton('days')} />
          <div className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Tabs className="min-w-0 max-w-full" idBase="reportes" label="Desglose" value={section} onChange={(s) => L.set({ seccion: s === 'barberos' ? null : s })}
                items={SECTIONS.map(({ id, label, icon }) => ({ id, label, icon }))} />
              {csvButton(SECTIONS.find((s) => s.id === section)!.csv)}
            </div>
            <TabPanel idBase="reportes" id={section}>
              {section === 'barberos' ? <StaffTable data={data} /> : section === 'metodos' ? <MethodsTable data={data} /> : <CatalogTable rows={section === 'servicios' ? data.byService : data.byProduct} total={section === 'servicios' ? data.kpis.serviceCents : data.kpis.productCents} kind={section} />}
            </TabPanel>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpis({ data }: { data: ReportOverviewDtoOutput }) {
  const k = data.kpis;
  const p = data.previousKpis;
  const occ = ratio(k.bookedMin, k.scheduledMin);
  const prevOcc = ratio(p.bookedMin, p.scheduledMin);
  const noShow = ratio(k.noShows, k.completed + k.noShows);
  const prevNoShow = ratio(p.noShows, p.completed + p.noShows);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi hero className="col-span-2 lg:col-span-1" label="Ingresos" value={formatMoney(k.revenueCents)} current={k.revenueCents} previous={p.revenueCents} hint={`Servicios ${formatMoney(k.serviceCents)} · Productos ${formatMoney(k.productCents)}`} />
      <Kpi label="Ventas" value={String(k.salesCount)} current={k.salesCount} previous={p.salesCount} hint={k.discountCents ? `Descuentos ${formatMoney(k.discountCents)}` : undefined} />
      <Kpi label="Ticket promedio" value={formatMoney(k.avgTicketCents)} current={k.avgTicketCents} previous={p.avgTicketCents} />
      <Kpi label="Propinas" value={formatMoney(k.tipCents)} current={k.tipCents} previous={p.tipCents} hint="Van al barbero; no suman a ingresos" />
      <Kpi label="Ocupación de la agenda" value={fmtPct(occ)} current={occ ?? undefined} previous={prevOcc ?? undefined} hint={k.scheduledMin ? `${fmtHours(k.bookedMin)} reservadas de ${fmtHours(k.scheduledMin)}` : 'Sin horario de trabajo en el período'} />
      <Kpi label="Citas" value={String(k.appointments)} current={k.appointments} previous={p.appointments} hint={`${k.completed} completadas${k.canceled ? ` · ${k.canceled} canceladas` : ''}`} />
      <Kpi label="Inasistencias" value={fmtPct(noShow)} current={noShow ?? undefined} previous={prevNoShow ?? undefined} lowerIsBetter hint={`${k.noShows} ${k.noShows === 1 ? 'cliente no vino' : 'clientes no vinieron'}`} />
      <Kpi label="Clientes atendidos" value={String(k.customers)} current={k.customers} previous={p.customers} hint={`${k.newCustomers} nuevos · ${k.returningCustomers} recurrentes`} />
    </div>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}

function StaffTable({ data }: { data: ReportOverviewDtoOutput }) {
  if (!data.byStaff.length) return <EmptyState title="Sin barberos" description="No hay barberos activos ni ventas en este período." />;
  return (
    <Scroll>
      <Table className="w-full min-w-[56rem]">
        <thead><tr><Th>Barbero</Th><Th className="text-right">Ingresos</Th><Th className="text-right">Servicios</Th><Th className="text-right">Productos</Th><Th className="text-right">Propinas</Th><Th className="text-right">Citas</Th><Th className="text-right">No asistió</Th><Th>Ocupación</Th></tr></thead>
        <tbody>
          {data.byStaff.map((s) => (
            <tr key={s.staff.id}>
              <Td className="font-medium text-slate-900">{s.staff.displayName}</Td>
              <Td className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(s.revenueCents)}</Td>
              <Td className="text-right tabular-nums">{s.servicesCount} <span className="text-slate-400">· {formatMoney(s.serviceCents)}</span></Td>
              <Td className="text-right tabular-nums">{s.productsCount} <span className="text-slate-400">· {formatMoney(s.productCents)}</span></Td>
              <Td className="text-right tabular-nums">{formatMoney(s.tipCents)}</Td>
              <Td className="text-right tabular-nums">{s.appointments}</Td>
              <Td className="text-right tabular-nums">{s.noShows}</Td>
              <Td title={s.scheduledMin ? `${fmtHours(s.bookedMin)} de ${fmtHours(s.scheduledMin)}` : 'Sin horario en el período'}><Meter value={ratio(s.bookedMin, s.scheduledMin)} label={`Ocupación de ${s.staff.displayName}`} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Scroll>
  );
}

function CatalogTable({ rows, total, kind }: { rows: ReportOverviewDtoOutput['byService']; total: number; kind: 'servicios' | 'productos' }) {
  if (!rows.length) return <EmptyState title={kind === 'servicios' ? 'Sin servicios vendidos' : 'Sin productos vendidos'} description="Aparecerán aquí al cobrar en caja." />;
  return (
    <Scroll>
      <Table className="w-full min-w-[36rem]">
        <thead><tr><Th>{kind === 'servicios' ? 'Servicio' : 'Producto'}</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Ingresos</Th><Th>Participación</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? r.name}>
              <Td className="font-medium text-slate-900">{r.name}</Td>
              <Td className="text-right tabular-nums">{r.quantity}</Td>
              <Td className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(r.revenueCents)}</Td>
              <Td><Meter value={ratio(r.revenueCents, total)} label={`Participación de ${r.name}`} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Scroll>
  );
}

function MethodsTable({ data }: { data: ReportOverviewDtoOutput }) {
  const total = data.byMethod.reduce((n, m) => n + m.amountCents, 0);
  if (!data.byMethod.length) return <EmptyState title="Sin pagos" description="Aparecerán aquí al cobrar en caja." />;
  return (
    <Scroll>
      <Table className="w-full min-w-[36rem]">
        <thead><tr><Th>Método</Th><Th className="text-right">Pagos</Th><Th className="text-right">Importe</Th><Th>Participación</Th></tr></thead>
        <tbody>
          {data.byMethod.map((m) => {
            const M = METHOD[m.method as Method];
            return (
              <tr key={m.method}>
                <Td><span className="flex items-center gap-2 font-medium text-slate-900"><M.icon className="size-4 text-slate-400" aria-hidden />{M.label}</span></Td>
                <Td className="text-right tabular-nums">{m.count}</Td>
                <Td className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(m.amountCents)}</Td>
                <Td><Meter value={ratio(m.amountCents, total)} label={`Participación de ${M.label}`} /></Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-slate-500">Incluye propinas: es lo que entró por cada método.</p>
    </Scroll>
  );
}

/** Adelantos cobrados en el período y en qué terminaron (el aplicado ya está dentro de los ingresos). */
function Deposits({ d }: { d: ReportOverviewDtoOutput['deposits'] }) {
  const parts = [
    { label: 'Aplicados en caja', cents: d.appliedCents },
    { label: 'Por usar (citas futuras)', cents: d.unusedCents },
    { label: 'Retenidos por inasistencia', cents: d.retainedCents },
    { label: 'Por devolver', cents: d.refundPendingCents },
    { label: 'Devueltos', cents: d.refundedCents },
  ].filter((p) => p.cents > 0);
  return (
    <section className="grid gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5" aria-label="Adelantos">
      <p className="text-sm text-slate-500">Adelantos cobrados al reservar</p>
      <p className="text-xl font-semibold tabular-nums text-slate-900">{formatMoney(d.paidCents)} <span className="text-sm font-normal text-slate-500">· {d.count} {d.count === 1 ? 'reserva' : 'reservas'}</span></p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p) => <div key={p.label} className="flex gap-1.5"><dt className="text-slate-500">{p.label}:</dt><dd className="font-medium tabular-nums text-slate-800">{formatMoney(p.cents)}</dd></div>)}
      </dl>
    </section>
  );
}
