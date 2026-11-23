import { CircleCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ComplaintReceiptDto, CreateComplaintDto, ProviderInfoDtoOutput } from '@/api/generated/model';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, Textarea } from '@/components/ui/form';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

type Form = {
  kind: 'reclamo' | 'queja';
  consumerName: string;
  docType: 'DNI' | 'CE' | 'PASAPORTE' | 'RUC';
  docNumber: string;
  consumerAddress: string;
  consumerPhone: string;
  consumerEmail: string;
  isMinor: boolean;
  guardianName: string;
  itemType: 'servicio' | 'producto';
  itemDescription: string;
  amount: string;
  detail: string;
  request: string;
};
const EMPTY: Form = {
  kind: 'reclamo', consumerName: '', docType: 'DNI', docNumber: '', consumerAddress: '', consumerPhone: '', consumerEmail: '',
  isMinor: false, guardianName: '', itemType: 'servicio', itemDescription: '', amount: '', detail: '', request: '',
};

const KINDS = [
  { id: 'reclamo', title: 'Reclamo', text: 'Disconformidad con el producto o servicio que recibiste.' },
  { id: 'queja', title: 'Queja', text: 'Malestar por la atención, sin relación con el producto o servicio.' },
] as const;

/**
 * Hoja de reclamación virtual (formato del reglamento del Libro de Reclamaciones). La usan el libro
 * de Cognira y el de cada barbería; `submit` decide a cuál va.
 */
export function ComplaintForm({ provider, submit }: {
  provider: ProviderInfoDtoOutput;
  submit: (data: CreateComplaintDto) => Promise<ComplaintReceiptDto>;
}) {
  const [f, setF] = useState<Form>(EMPTY);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<ComplaintReceiptDto | null>(null);
  const now = useNow();
  const fe = error instanceof ApiError ? error.fieldErrors() : {};
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const amount = f.amount.trim() ? Math.round(Number(f.amount.replace(',', '.')) * 100) : undefined;
    try {
      const r = await submit({
        kind: f.kind,
        consumerName: f.consumerName,
        docType: f.docType,
        docNumber: f.docNumber,
        consumerAddress: f.consumerAddress,
        consumerPhone: f.consumerPhone || undefined,
        consumerEmail: f.consumerEmail,
        isMinor: f.isMinor,
        guardianName: f.isMinor ? f.guardianName : undefined,
        itemType: f.itemType,
        itemDescription: f.itemDescription,
        amountCents: Number.isFinite(amount) ? amount : undefined,
        detail: f.detail,
        request: f.request,
      });
      setReceipt(r);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const today = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' });
  if (receipt)
    return (
      <div role="status" className="grid justify-items-center gap-3 rounded-xl border bg-white p-6 text-center">
        <CircleCheck className="size-10 text-emerald-600" aria-hidden />
        <p className="text-lg font-semibold text-slate-900">Registramos tu hoja {receipt.code}</p>
        <p className="max-w-md text-sm text-slate-600">
          Te enviamos una copia a tu correo. {provider.tradeName} te responderá por correo a más tardar el{' '}
          <strong>{today.format(new Date(receipt.dueAt))}</strong> (15 días hábiles).
        </p>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      <section className="grid gap-1 rounded-xl border bg-white p-5 text-sm">
        <h2 className="font-semibold text-slate-900">Proveedor</h2>
        <p>{provider.legalName ?? provider.tradeName}{provider.taxId ? ` · RUC ${provider.taxId}` : ''}</p>
        {provider.address && <p className="text-slate-500">{provider.address}</p>}
        <p className="text-slate-500">Fecha: {today.format(now)}</p>
      </section>

      {error && !Object.keys(fe).length ? <Alert title={errorMessage(error, i18n.t)} /> : null}
      {Object.keys(fe).length ? <Alert title="Revisa los campos marcados." /> : null}

      <section className="grid gap-4 rounded-xl border bg-white p-5">
        <h2 className="font-semibold text-slate-900">1. Tus datos</h2>
        <Field label="Nombre y apellidos" error={fe.consumerName}>{(p) => <Input {...p} autoComplete="name" value={f.consumerName} onChange={set('consumerName')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Documento">{(p) => (
            <Select {...p} value={f.docType} onChange={set('docType')}>
              <option value="DNI">DNI</option><option value="CE">Carné de extranjería</option><option value="PASAPORTE">Pasaporte</option><option value="RUC">RUC</option>
            </Select>
          )}</Field>
          <Field label="Número de documento" error={fe.docNumber}>{(p) => <Input {...p} inputMode={f.docType === 'DNI' || f.docType === 'RUC' ? 'numeric' : 'text'} value={f.docNumber} onChange={set('docNumber')} />}</Field>
        </div>
        <Field label="Domicilio" error={fe.consumerAddress}>{(p) => <Input {...p} autoComplete="street-address" value={f.consumerAddress} onChange={set('consumerAddress')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo" error={fe.consumerEmail} hint="Aquí te llegan la copia y la respuesta.">{(p) => <Input {...p} type="email" autoComplete="email" value={f.consumerEmail} onChange={set('consumerEmail')} />}</Field>
          <Field label="Celular (opcional)" error={fe.consumerPhone}>{(p) => <Input {...p} type="tel" autoComplete="tel" value={f.consumerPhone} onChange={set('consumerPhone')} />}</Field>
        </div>
        <Checkbox label="Soy menor de edad" checked={f.isMinor} onChange={(e) => setF({ ...f, isMinor: e.target.checked })} />
        {f.isMinor && (
          <Field label="Nombre del padre, madre o apoderado" error={fe.guardianName}>{(p) => <Input {...p} value={f.guardianName} onChange={set('guardianName')} />}</Field>
        )}
      </section>

      <section className="grid gap-4 rounded-xl border bg-white p-5">
        <h2 className="font-semibold text-slate-900">2. Producto o servicio</h2>
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Tipo</legend>
          {(['servicio', 'producto'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="radio" name="itemType" className="accent-marca-700" checked={f.itemType === t} onChange={() => setF({ ...f, itemType: t })} />
              {t === 'servicio' ? 'Servicio' : 'Producto'}
            </label>
          ))}
        </fieldset>
        <Field label="Descripción" error={fe.itemDescription}>{(p) => <Input {...p} placeholder="Ej.: Corte clásico del 15 de noviembre" value={f.itemDescription} onChange={set('itemDescription')} />}</Field>
        <Field label="Monto reclamado en S/ (opcional)" error={fe.amountCents}>{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={set('amount')} />}</Field>
      </section>

      <section className="grid gap-4 rounded-xl border bg-white p-5">
        <h2 className="font-semibold text-slate-900">3. Detalle</h2>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Tipo de hoja</legend>
          {KINDS.map((k) => (
            <label key={k.id} className={cn('grid cursor-pointer gap-0.5 rounded-lg border p-3 text-sm', f.kind === k.id ? 'border-marca-600 bg-marca-50' : 'border-slate-200')}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="kind" className="accent-marca-700" checked={f.kind === k.id} onChange={() => setF({ ...f, kind: k.id })} />
                {k.title}
              </span>
              <span className="text-slate-500">{k.text}</span>
            </label>
          ))}
        </fieldset>
        <Field label="¿Qué pasó?" error={fe.detail}>{(p) => <Textarea {...p} rows={5} maxLength={3000} value={f.detail} onChange={set('detail')} />}</Field>
        <Field label="¿Qué pides?" error={fe.request}>{(p) => <Textarea {...p} rows={3} maxLength={2000} placeholder="Ej.: la devolución de mi adelanto" value={f.request} onChange={set('request')} />}</Field>
      </section>

      <p className="text-xs text-slate-500">
        La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia
        ante el INDECOPI. El proveedor debe responder en un plazo no mayor a 15 días hábiles.
      </p>
      <Checkbox label="Declaro que los datos son verdaderos." checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
      <Button type="submit" size="lg" loading={pending} disabled={!accepted}>Enviar hoja de reclamación</Button>
    </form>
  );
}
