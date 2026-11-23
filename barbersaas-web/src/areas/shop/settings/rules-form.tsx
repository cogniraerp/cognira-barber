import { useState } from 'react';
import { isApiError } from '@/api/errors';
import { useProfileControllerGetBookingRules, useProfileControllerSetBookingRules } from '@/api/generated/endpoints';
import type { BookingRulesDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { Link } from 'react-router';
import { useShop } from '../shop-context';
import { DepositFields } from './deposit-fields';
import { Section } from './shared';
import { saved, useRefreshShop } from './shared-utils';

export function RulesForm() {
  const rules = useProfileControllerGetBookingRules({ query: {} });
  if (!rules.data) return <Skeleton className="h-96" />;
  return <RulesEditor initial={rules.data as BookingRulesDto} />;
}

function RulesEditor({ initial }: { initial: BookingRulesDto }) {
  const refresh = useRefreshShop();
  const save = useProfileControllerSetBookingRules({ mutation: { onSuccess: async () => { await refresh(); saved(); } } });
  const [r, setR] = useState<BookingRulesDto>(initial);
  const fe = isApiError(save.error) ? save.error.fieldErrors() : {};
  const set = (patch: Partial<BookingRulesDto>) => setR({ ...r, ...patch });
  const num = (k: keyof BookingRulesDto) => (e: { target: { value: string } }) => set({ [k]: Number(e.target.value) } as Partial<BookingRulesDto>);
  const req = r.requiredFields ?? { name: 'required', phone: 'required', email: 'optional' };
  const onlinePayments = useShop().plan.features.onlinePayments;
  const dep = { required: false, type: 'percent' as const, value: 0, appliesTo: 'all' as const, holdMinutes: 15, retainOnNoShow: true, ...r.deposit };

  return (
    <div className="grid gap-4">
      {save.error && !Object.keys(fe).length ? <Alert title={errorMessage(save.error, i18n.t)} /> : null}
      <Section title="Cuándo se puede reservar">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Anticipación mínima" error={fe.minNoticeMinutes}>{(p) => <Select {...p} value={r.minNoticeMinutes} onChange={num('minNoticeMinutes')}>{[[0, 'Sin mínimo'], [30, '30 min'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [720, '12 horas'], [1440, '1 día']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
          <Field label="Hasta cuántos días antes" error={fe.maxAdvanceDays}>{(p) => <Input {...p} type="number" min={1} max={365} value={r.maxAdvanceDays} onChange={num('maxAdvanceDays')} />}</Field>
          <Field label="Intervalo entre horarios" error={fe.slotIntervalMinutes}>{(p) => <Select {...p} value={r.slotIntervalMinutes} onChange={num('slotIntervalMinutes')}>{[5, 10, 15, 20, 30, 60].map((v) => <option key={v} value={v}>Cada {v} min</option>)}</Select>}</Field>
        </div>
      </Section>
      <Section title="Elección de barbero">
        <div className="grid gap-2">
          <Checkbox label="El cliente puede elegir barbero" checked={r.allowStaffSelection ?? true} onChange={(e) => set({ allowStaffSelection: e.target.checked })} />
          <Checkbox label='Ofrecer "cualquier barbero disponible"' checked={r.allowAnyStaff ?? true} onChange={(e) => set({ allowAnyStaff: e.target.checked })} />
          {fe.allowAnyStaff && <p role="alert" className="text-sm text-destructive">{fe.allowAnyStaff}</p>}
        </div>
      </Section>
      <Section title="Confirmación, cancelación y límites">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Las reservas online quedan">{(p) => <Select {...p} value={r.approvalMode} onChange={(e) => set({ approvalMode: e.target.value as 'auto' })}><option value="auto">Confirmadas al instante</option><option value="manual">Pendientes hasta que las apruebes</option></Select>}</Field>
          <Field label="Reservas activas por cliente" error={fe.maxActiveBookingsPerCustomer}>{(p) => <Input {...p} type="number" min={1} max={50} value={r.maxActiveBookingsPerCustomer} onChange={num('maxActiveBookingsPerCustomer')} />}</Field>
          <Field label="Cancelar en línea hasta (horas antes)" error={fe.cancellationWindowHours}>{(p) => <Input {...p} type="number" min={0} max={168} value={r.cancellationWindowHours} onChange={num('cancellationWindowHours')} />}</Field>
          <Field label="Reprogramar en línea hasta (horas antes)" error={fe.rescheduleWindowHours}>{(p) => <Input {...p} type="number" min={0} max={168} value={r.rescheduleWindowHours} onChange={num('rescheduleWindowHours')} />}</Field>
        </div>
      </Section>
      <Section title="Adelanto al reservar en línea"
        description={onlinePayments
          ? 'El cliente paga el adelanto con tu pasarela para confirmar su reserva; el horario queda apartado mientras paga. Se descuenta al cobrar en caja.'
          : 'Disponible en los planes con pagos en línea (Pro o Premium).'}>
        <div className="grid gap-3">
          <DepositFields value={{ required: dep.required, type: dep.type, value: dep.value }} error={fe['deposit.value']}
            onChange={(v) => set({ deposit: { ...dep, ...(v ?? { required: false, type: 'percent', value: 0 }) } })} />
          {dep.required && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pedirlo a">{(p) => <Select {...p} value={dep.appliesTo} onChange={(e) => set({ deposit: { ...dep, appliesTo: e.target.value as 'all' } })}><option value="all">Todos los clientes</option><option value="new_or_no_show">Solo clientes nuevos o que ya faltaron</option></Select>}</Field>
              <Field label="Apartar el horario mientras paga" error={fe['deposit.holdMinutes']}>{(p) => <Select {...p} value={dep.holdMinutes} onChange={(e) => set({ deposit: { ...dep, holdMinutes: Number(e.target.value) } })}>{[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}</Select>}</Field>
            </div>
          )}
          {dep.required && <Checkbox label="Si el cliente no se presenta, me quedo con el adelanto (si lo desmarcas, se le devuelve)" checked={dep.retainOnNoShow ?? true} onChange={(e) => set({ deposit: { ...dep, retainOnNoShow: e.target.checked } })} />}
          {dep.required && <p className="text-sm text-slate-500">Si cancela a tiempo (o cancelas tú), el adelanto se devuelve. Necesitas una pasarela activa en <Link to="../pagos" relative="path" className="font-medium text-marca-700 hover:underline">Pagos en línea</Link>; sin ella, las reservas se confirman sin adelanto. Puedes poner excepciones en cada servicio.</p>}
        </div>
      </Section>
      <Section title="Datos que pedimos al cliente" description="El nombre siempre se pide. Debe pedirse al menos teléfono o email.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(['phone', 'email'] as const).map((k) => (
            <Field key={k} label={k === 'phone' ? 'Teléfono (WhatsApp)' : 'Email'}>
              {(p) => <Select {...p} value={req[k]} onChange={(e) => set({ requiredFields: { ...req, [k]: e.target.value } as BookingRulesDto['requiredFields'] })}><option value="required">Obligatorio</option><option value="optional">Opcional</option><option value="hidden">No pedir</option></Select>}
            </Field>
          ))}
        </div>
        {fe.requiredFields && <p role="alert" className="text-sm text-destructive">{fe.requiredFields}</p>}
      </Section>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate({ data: r })}>Guardar reglas</Button></div>
    </div>
  );
}
