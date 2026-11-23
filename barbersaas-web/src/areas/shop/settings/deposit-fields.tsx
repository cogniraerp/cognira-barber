import { useState } from 'react';
import { Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/utils';
import { centsToInput, parseMoney } from '../inventory/money';

export type DepositRule = { required: boolean; type: 'percent' | 'fixed' | 'full'; value: number };
type Mode = 'none' | DepositRule['type'];

/** Texto corto de una regla ("50 %", "S/ 10.00", "Pago total", "Sin adelanto"). */
export function depositLabel(r: DepositRule | null | undefined): string {
  if (!r) return 'Regla general';
  if (!r.required) return 'Sin adelanto';
  if (r.type === 'full') return 'Pago total';
  return r.type === 'percent' ? `${r.value} %` : formatMoney(r.value);
}

/**
 * Tipo y monto de un adelanto: porcentaje (1–100), monto fijo en soles o pago total.
 * `inherit` agrega la opción "Usar la regla general" (excepción de un servicio).
 */
export function DepositFields({ value, onChange, inherit, error }: {
  value: DepositRule | null;
  onChange: (v: DepositRule | null) => void;
  inherit?: boolean;
  error?: string;
}) {
  const mode: Mode | 'inherit' = value === null ? 'inherit' : !value.required ? 'none' : value.type;
  const [text, setText] = useState(value?.type === 'fixed' ? centsToInput(value.value) : value?.type === 'percent' ? String(value.value) : '');
  const pick = (m: Mode | 'inherit') => {
    if (m === 'inherit') return onChange(null);
    if (m === 'none') return onChange({ required: false, type: 'percent', value: 0 });
    const v = m === 'percent' ? 50 : m === 'fixed' ? 1000 : 0;
    setText(m === 'percent' ? '50' : m === 'fixed' ? '10.00' : '');
    onChange({ required: true, type: m, value: v });
  };
  const amount = (t: string) => {
    setText(t);
    if (!value) return;
    const n = value.type === 'percent' ? Math.round(Number(t)) : parseMoney(t);
    if (n !== null && Number.isFinite(n)) onChange({ ...value, value: n });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Adelanto">
        {(p) => (
          <Select {...p} value={mode} onChange={(e) => pick(e.target.value as Mode | 'inherit')}>
            {inherit && <option value="inherit">Usar la regla general</option>}
            <option value="none">Sin adelanto</option>
            <option value="percent">Porcentaje del precio</option>
            <option value="fixed">Monto fijo</option>
            <option value="full">Pago total al reservar</option>
          </Select>
        )}
      </Field>
      {value?.required && value.type !== 'full' && (
        <Field label={value.type === 'percent' ? 'Porcentaje (%)' : 'Monto (S/)'} error={error}>
          {(p) => <Input {...p} inputMode="decimal" value={text} onChange={(e) => amount(e.target.value)} />}
        </Field>
      )}
    </div>
  );
}
