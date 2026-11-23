import { keepPreviousData } from '@tanstack/react-query';
import { ArrowDownLeft, History, Lock, LockOpen, LogOut, Receipt, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCashControllerCurrent, useCashControllerGet, useCashControllerList } from '@/api/generated/endpoints';
import type { CurrentCashDtoShift, CurrentCashDtoShiftMovementsItem } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Alert, Badge, Skeleton } from '@/components/ui/misc';
import { FilterBar, MobileCard, PageHeader, Pagination, Table, Td, Th } from '@/components/ui/table';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { fromWall, parseWall } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useListParams } from '@/lib/use-list-params';
import { cn, formatMoney } from '@/lib/utils';
import { useShop } from '../shop-context';
import { CashMovementDialog, CloseDialog, Diff, OpenDialog } from './cash-dialogs';
import { KIND, METHOD, type Kind, type Method } from './methods';

type Tab = 'turno' | 'historial';

/** Caja: turno actual (abrir, movimientos, cerrar con arqueo) e historial de turnos. */
export function CashPage() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get('seccion') === 'historial' ? 'historial' : 'turno';
  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Caja" subtitle="Turnos de caja: fondo inicial, ingresos y egresos, y cierre con arqueo." />
      <Tabs idBase="caja" label="Caja" value={tab} onChange={(t) => setSp(t === 'turno' ? {} : { seccion: t }, { replace: true })}
        items={[{ id: 'turno', label: 'Turno actual', icon: <Wallet aria-hidden /> }, { id: 'historial', label: 'Historial', icon: <History aria-hidden /> }]} />
      <TabPanel idBase="caja" id={tab}>{tab === 'turno' ? <Current /> : <Shifts />}</TabPanel>
    </div>
  );
}

function Current() {
  const q = useCashControllerCurrent({}, { query: { refetchInterval: 30_000 } });
  const [dialog, setDialog] = useState<'open' | 'close' | 'income' | 'expense' | 'withdrawal' | null>(null);
  if (q.error) return <Alert title={errorMessage(q.error, i18n.t)} />;
  if (!q.data) return <Skeleton className="h-72" />;
  const { register, shift } = q.data;
  if (!shift) {
    return (
      <>
        <div className="grid place-items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Lock className="size-7" aria-hidden /></span>
          <div>
            <p className="text-lg font-semibold text-slate-900">{register.name} · cerrada</p>
            <p className="text-sm text-slate-500">Ábrela con el fondo de efectivo para empezar a cobrar.</p>
          </div>
          <Button size="lg" onClick={() => setDialog('open')}><LockOpen aria-hidden /> Abrir caja</Button>
        </div>
        {dialog === 'open' && <OpenDialog onClose={() => setDialog(null)} />}
      </>
    );
  }
  const cash = shift.totals.find((x) => x.method === 'cash')!;
  return (
    <div className="grid gap-4">
      <OpenHeader shift={shift} registerName={register.name}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('income')}><ArrowDownLeft aria-hidden /> Ingreso</Button>
            <Button variant="outline" onClick={() => setDialog('expense')}><Receipt aria-hidden /> Egreso</Button>
            <Button variant="outline" onClick={() => setDialog('withdrawal')}><LogOut aria-hidden /> Retiro</Button>
            <Button onClick={() => setDialog('close')}><Lock aria-hidden /> Cerrar caja</Button>
          </>
        } />
      <Totals shift={shift} />
      <Movements items={shift.movements} />
      {(dialog === 'income' || dialog === 'expense' || dialog === 'withdrawal') && <CashMovementDialog kind={dialog} cashAvailable={cash.expectedCents} onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseDialog shift={shift} onClose={() => setDialog(null)} />}
    </div>
  );
}

function OpenHeader({ shift, registerName, actions }: { shift: NonNullable<CurrentCashDtoShift>; registerName: string; actions?: React.ReactNode }) {
  const tz = useShop().barbershop.timezone;
  const time = new Intl.DateTimeFormat('es-PE', { timeStyle: 'short', dateStyle: 'medium', timeZone: tz });
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid gap-1">
        <p className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">{registerName}</span>
          {shift.status === 'open' ? <Badge tone="success"><LockOpen className="mr-1 size-3" aria-hidden />Abierta</Badge> : <Badge><Lock className="mr-1 size-3" aria-hidden />Cerrada</Badge>}
        </p>
        <p className="text-sm text-slate-500">
          Abrió {shift.openedBy ?? '—'} · {time.format(new Date(shift.openedAt))} · Fondo {formatMoney(shift.openingCents)}
          {shift.closedAt && <> · Cerró {shift.closedBy ?? '—'} · {time.format(new Date(shift.closedAt))}</>}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Efectivo en caja como cifra protagonista; el resto de métodos al lado. */
function Totals({ shift }: { shift: NonNullable<CurrentCashDtoShift> }) {
  const cash = shift.totals.find((x) => x.method === 'cash')!;
  const others = shift.totals.filter((x) => x.method !== 'cash');
  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_3fr]">
      <div className="grid gap-1 rounded-2xl bg-gradient-to-br from-marca-700 via-marca-900 to-noche p-5 text-white">
        <span className="flex items-center gap-2 text-sm text-celeste-100"><Wallet className="size-4" aria-hidden />{shift.status === 'open' ? 'Efectivo en caja' : 'Efectivo esperado'}</span>
        <span className="text-3xl font-semibold tabular-nums">{formatMoney(cash.expectedCents)}</span>
        <span className="text-sm text-slate-300">Fondo {formatMoney(shift.openingCents)} · entró {formatMoney(cash.inCents)} · salió {formatMoney(cash.outCents)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {others.map((x) => {
          const M = METHOD[x.method as Method];
          return (
            <div key={x.method} className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white p-4">
              <span className="flex items-center gap-1.5 text-sm text-slate-500"><M.icon className="size-4" aria-hidden />{M.label}</span>
              <span className="text-xl font-semibold text-slate-900 tabular-nums">{formatMoney(x.expectedCents)}</span>
            </div>
          );
        })}
        <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white p-4">
          <span className="text-sm text-slate-500">Entradas / salidas</span>
          <span className="text-sm font-medium tabular-nums"><span className="text-emerald-700">+{formatMoney(shift.totalInCents)}</span> · <span className="text-red-700">−{formatMoney(shift.totalOutCents)}</span></span>
          <span className="text-xs text-slate-500">{shift.movementsCount} movimiento{shift.movementsCount === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

function Movements({ items }: { items: CurrentCashDtoShiftMovementsItem[] }) {
  const tz = useShop().barbershop.timezone;
  const time = new Intl.DateTimeFormat('es-PE', { timeStyle: 'short', timeZone: tz });
  if (!items.length) return <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Sin movimientos todavía. Las ventas cobradas aparecerán aquí.</p>;
  return (
    <>
      <ul className="grid gap-2 md:hidden">
        {items.map((m) => {
          const K = KIND[m.kind as Kind];
          return (
            <li key={m.id}>
              <MobileCard className="flex items-center justify-between gap-3 text-sm">
                <span className="grid min-w-0">
                  <span className="truncate font-medium text-slate-900">{m.concept}</span>
                  <span className="text-slate-500">{time.format(new Date(m.createdAt))} · {K.label} · {METHOD[m.method as Method].label}</span>
                </span>
                <Amount cents={m.amountCents} inflow={K.in} />
              </MobileCard>
            </li>
          );
        })}
      </ul>
      <div className="hidden md:block">
        <Table>
          <thead><tr><Th>Hora</Th><Th>Tipo</Th><Th>Concepto</Th><Th>Método</Th><Th className="text-right">Monto</Th><Th>Registró</Th></tr></thead>
          <tbody>
            {items.map((m) => {
              const K = KIND[m.kind as Kind];
              const M = METHOD[m.method as Method];
              return (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-slate-500 tabular-nums">{time.format(new Date(m.createdAt))}</Td>
                  <Td><Badge tone={K.tone}><K.icon className="mr-1 size-3" aria-hidden />{K.label}</Badge></Td>
                  <Td className="font-medium text-slate-900">{m.concept}</Td>
                  <Td><span className="inline-flex items-center gap-1.5"><M.icon className="size-4 text-slate-400" aria-hidden />{M.label}</span></Td>
                  <Td className="text-right"><Amount cents={m.amountCents} inflow={K.in} /></Td>
                  <Td className="text-slate-500">{m.createdBy ?? '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </>
  );
}

function Amount({ cents, inflow }: { cents: number; inflow: boolean }) {
  return <span className={cn('font-semibold tabular-nums', inflow ? 'text-emerald-700' : 'text-red-700')}>{inflow ? '+' : '−'}{formatMoney(cents)}</span>;
}

function Shifts() {
  const tz = useShop().barbershop.timezone;
  const L = useListParams(20);
  const [open, setOpen] = useState<string | null>(null);
  const desde = L.get('desde');
  const hasta = L.get('hasta');
  const list = useCashControllerList(
    { page: L.page, pageSize: L.pageSize, from: desde ? fromWall(parseWall(desde, '00:00'), tz) : undefined, to: hasta ? fromWall(parseWall(hasta, '23:59'), tz) : undefined },
    { query: { placeholderData: keepPreviousData } },
  );
  const fmt = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const data = list.data;
  return (
    <div className="grid gap-4">
      <FilterBar>
        <label className="flex items-center gap-2 text-sm text-slate-500">Desde<Input type="date" className="w-auto" value={desde} onChange={(e) => L.set({ desde: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-500">Hasta<Input type="date" className="w-auto" value={hasta} onChange={(e) => L.set({ hasta: e.target.value })} /></label>
      </FilterBar>
      {list.error ? <Alert title={errorMessage(list.error, i18n.t)} /> : !data ? <Skeleton className="h-64" /> : data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Sin turnos en este período.</p>
      ) : (
        <>
          <Table aria-busy={list.isFetching}>
            <thead><tr><Th>Apertura</Th><Th>Cierre</Th><Th>Responsables</Th><Th className="text-right">Fondo</Th><Th className="text-right">Entradas</Th><Th className="text-right">Salidas</Th><Th>Arqueo</Th><Th className="text-right">Detalle</Th></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap">{fmt.format(new Date(s.openedAt))}</Td>
                  <Td className="whitespace-nowrap">{s.closedAt ? fmt.format(new Date(s.closedAt)) : <Badge tone="success"><LockOpen className="mr-1 size-3" aria-hidden />Abierta</Badge>}</Td>
                  <Td className="text-slate-500">{s.openedBy ?? '—'}{s.closedBy && s.closedBy !== s.openedBy ? ` → ${s.closedBy}` : ''}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.openingCents)}</Td>
                  <Td className="text-right text-emerald-700 tabular-nums">+{formatMoney(s.totalInCents)}</Td>
                  <Td className="text-right text-red-700 tabular-nums">−{formatMoney(s.totalOutCents)}</Td>
                  <Td>{s.status === 'closed' ? <Diff cents={s.differenceCents} /> : <span className="text-slate-400">En curso</span>}</Td>
                  <Td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(s.id)}>Ver</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={L.setPage} onPageSize={L.setPageSize} />
        </>
      )}
      {open && <ShiftDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ShiftDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useCashControllerGet(id);
  return (
    <Dialog open onClose={onClose} title="Turno de caja" className="max-w-4xl">
      {!q.data ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4">
          <OpenHeader shift={q.data} registerName={q.data.register.name} />
          {q.data.status === 'closed' && (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/80 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <tr><th className="px-3 py-2 text-left">Método</th><th className="px-3 py-2 text-right">Esperado</th><th className="px-3 py-2 text-right">Contado</th><th className="px-3 py-2 text-right">Diferencia</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.totals.map((x) => (
                    <tr key={x.method}>
                      <td className="px-3 py-2 font-medium">{METHOD[x.method as Method].label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(x.expectedCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{x.countedCents === null ? '—' : formatMoney(x.countedCents)}</td>
                      <td className="px-3 py-2 text-right"><Diff cents={x.differenceCents} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.data.notes && <Alert tone="info" title={`Observación: ${q.data.notes}`} />}
          <Movements items={q.data.movements} />
        </div>
      )}
    </Dialog>
  );
}
