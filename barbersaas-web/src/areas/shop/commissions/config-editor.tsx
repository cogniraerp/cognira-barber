import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommissionsControllerGetConfig, useCommissionsControllerSetConfig, useServicesControllerList } from '@/api/generated/endpoints';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import { centsToInput, parseMoney } from '../inventory/money';
import { saved, useRefreshShop } from '../settings/shared-utils';
import type { Config, Rule } from './rule-utils';

/** Regla en edición: el valor se escribe como "40" (%) o "5.00" (S/). */
type Draft = { type: Rule['type']; text: string };
const toDraft = (r: Rule): Draft => ({ type: r.type, text: r.type === 'percent' ? String(r.value / 100) : centsToInput(r.value) });
function fromDraft(d: Draft): Rule | null {
  if (d.type === 'percent') {
    const n = Number(d.text.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? { type: 'percent', value: Math.round(n * 100) } : null;
  }
  const c = parseMoney(d.text || '0');
  return c === null ? null : { type: 'fixed', value: c };
}

export function CommissionConfigDialog({ staffId, staffName, onClose }: { staffId: string; staffName: string; onClose: () => void }) {
  const q = useCommissionsControllerGetConfig(staffId);
  return (
    <Dialog open onClose={onClose} title={`Comisión de ${staffName}`} className="max-w-xl"
      description="Se aplica a lo que cobre de ahora en adelante; lo ya ganado no cambia.">
      {!q.data ? <Skeleton className="h-48" /> : <ConfigForm staffId={staffId} initial={q.data as Config} onDone={onClose} />}
    </Dialog>
  );
}

/** Editor de la regla (también va en la pestaña "Comisión" del barbero). */
export function ConfigForm({ staffId, initial, onDone }: { staffId: string; initial: Config; onDone?: () => void }) {
  const { t } = useTranslation();
  const refresh = useRefreshShop();
  const services = useServicesControllerList({});
  const [service, setService] = useState(toDraft(initial.service));
  const [product, setProduct] = useState(toDraft(initial.product));
  const [overrides, setOverrides] = useState(initial.overrides.map((o) => ({ serviceId: o.serviceId, ...toDraft(o) })));
  const save = useCommissionsControllerSetConfig({ mutation: { onSuccess: async () => { await refresh(); saved('Comisión guardada'); onDone?.(); } } });
  const parsed = { service: fromDraft(service), product: fromDraft(product), overrides: overrides.map((o) => ({ serviceId: o.serviceId, rule: fromDraft(o) })) };
  const invalid = !parsed.service || !parsed.product || parsed.overrides.some((o) => !o.rule || !o.serviceId);
  const used = new Set(overrides.map((o) => o.serviceId));
  const submit = () =>
    save.mutate({
      staffId,
      data: { service: parsed.service!, product: parsed.product!, overrides: parsed.overrides.map((o) => ({ serviceId: o.serviceId, ...o.rule! })) },
    });

  return (
    <div className="grid gap-4">
      {save.error ? <Alert title={errorMessage(save.error, t)} /> : null}
      <RuleRow label="Servicios" draft={service} onChange={setService} />
      <RuleRow label="Productos" draft={product} onChange={setProduct} />
      <div className="grid gap-2">
        <p className="text-sm font-medium text-slate-700">Excepciones por servicio</p>
        {overrides.length === 0 && <p className="text-sm text-slate-500">Ninguna. Ej.: "Corte niño" con monto fijo de S/ 5.</p>}
        {overrides.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label="Servicio" className="h-10 min-w-0 flex-1" value={o.serviceId} onChange={(e) => setOverrides(overrides.map((x, k) => (k === i ? { ...x, serviceId: e.target.value } : x)))}>
              <option value="">Elige un servicio</option>
              {services.data?.filter((s) => s.isActive && (s.id === o.serviceId || !used.has(s.id))).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <RuleInputs draft={o} onChange={(d) => setOverrides(overrides.map((x, k) => (k === i ? { ...x, ...d } : x)))} />
            <Button variant="ghost" size="icon" className="size-10 text-slate-400 hover:text-red-600" aria-label="Quitar excepción" onClick={() => setOverrides(overrides.filter((_, k) => k !== i))}><Trash2 aria-hidden /></Button>
          </div>
        ))}
        <Button variant="link" className="h-auto justify-self-start px-0" onClick={() => setOverrides([...overrides, { serviceId: '', type: 'fixed', text: '' }])}><Plus aria-hidden /> Agregar excepción</Button>
      </div>
      <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Las <strong>propinas</strong> son 100 % del barbero que la recibe. El descuento general de una venta se reparte entre sus ítems, así la comisión es sobre lo que realmente se cobró.</p>
      <div className="flex justify-end gap-2">
        {onDone && <Button variant="ghost" onClick={onDone}>{t('app.cancel')}</Button>}
        <Button loading={save.isPending} disabled={invalid} onClick={submit}>Guardar comisión</Button>
      </div>
    </div>
  );
}

function RuleRow({ label, draft, onChange }: { label: string; draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
      <span className="font-medium text-slate-900">{label}</span>
      <RuleInputs draft={draft} onChange={onChange} label={label} />
    </div>
  );
}

function RuleInputs({ draft, onChange, label = 'Excepción' }: { draft: Draft; onChange: (d: Draft) => void; label?: string }) {
  const bad = fromDraft(draft) === null;
  return (
    <span className="flex items-center gap-2">
      <Select aria-label={`Tipo de comisión (${label})`} className="h-10 w-auto" value={draft.type} onChange={(e) => onChange({ type: e.target.value as Rule['type'], text: '' })}>
        <option value="percent">Porcentaje</option>
        <option value="fixed">Monto fijo</option>
      </Select>
      <span className="relative">
        {draft.type === 'fixed' && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">S/</span>}
        <Input aria-label={`Valor (${label})`} aria-invalid={bad || undefined} inputMode="decimal" placeholder="0"
          className={`h-10 w-28 text-right tabular-nums ${draft.type === 'fixed' ? 'pl-8' : 'pr-8'}`} value={draft.text} onChange={(e) => onChange({ ...draft, text: e.target.value })} />
        {draft.type === 'percent' && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-400">%</span>}
      </span>
    </span>
  );
}
