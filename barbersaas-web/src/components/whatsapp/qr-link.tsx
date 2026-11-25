import { CheckCircle2, QrCode, RefreshCw, Smartphone, Unlink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WhatsAppQrDtoOutput as WhatsAppQrDto } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/errors';
import i18n from '@/lib/i18n';

/** Cada cuánto se consulta (el QR de WhatsApp se renueva solo; así también se detecta el escaneo). */
const POLL_MS = 4000;
/** Tras este tiempo sin escanear se deja de consultar (se puede volver a pedir el QR). */
const MAX_POLL_MS = 3 * 60_000;

/**
 * Vincular un WhatsApp escaneando un QR (Evolution). `requestQr` crea la instancia si hace falta y
 * devuelve el QR o, si ya se escaneó, el número conectado.
 */
export function QrLink({
  phone,
  connected,
  requestQr,
  disconnect,
  onLinked,
}: {
  phone: string | null;
  connected: boolean;
  requestQr: () => Promise<WhatsAppQrDto>;
  disconnect: () => Promise<unknown>;
  onLinked: (phone: string | null) => void;
}) {
  const [qr, setQr] = useState<WhatsAppQrDto | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const started = useRef(0);

  const ask = async () => {
    try {
      const r = await requestQr();
      setError(null);
      if (r.state === 'open') {
        setPolling(false);
        setQr(null);
        onLinked(r.phone);
      } else setQr(r);
    } catch (e) {
      setError(e);
      setPolling(false);
    }
  };

  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      if (Date.now() - started.current > MAX_POLL_MS) {
        setPolling(false);
        return;
      }
      void ask();
    }, POLL_MS);
    return () => window.clearInterval(id);
  });

  const start = async () => {
    setBusy(true);
    started.current = Date.now();
    await ask();
    setBusy(false);
    setPolling(true);
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await disconnect();
      setQr(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (connected)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
        <span className="grid">
          <span className="font-medium text-emerald-900">WhatsApp vinculado</span>
          <span className="text-emerald-800">{phone ?? 'Número conectado'}</span>
        </span>
        <Button size="sm" variant="outline" className="ml-auto bg-white" loading={busy} onClick={() => void unlink()}>
          <Unlink aria-hidden /> Desvincular
        </Button>
      </div>
    );

  return (
    <div className="grid gap-3 rounded-lg border p-4">
      {error ? <Alert title={errorMessage(error, i18n.t)} /> : null}
      {qr?.qr ? (
        <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
          <img src={qr.qr} alt="Código QR para vincular WhatsApp" className="size-56 rounded-lg border bg-white p-2" />
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-slate-700">
            <li>Abre <strong>WhatsApp</strong> en el celular de la barbería.</li>
            <li>Toca <strong>⋮ Más opciones</strong> (Android) o <strong>Configuración</strong> (iPhone) → <strong>Dispositivos vinculados</strong>.</li>
            <li>Toca <strong>Vincular un dispositivo</strong> y apunta la cámara a este código.</li>
            <li className="list-none text-slate-500">
              {polling ? 'Esperando el escaneo… (el código se renueva solo)' : 'El código venció.'}{' '}
              {!polling && (
                <button type="button" className="font-medium text-marca-700 underline" onClick={() => void start()}>
                  Mostrar otro
                </button>
              )}
            </li>
          </ol>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Smartphone className="size-5 text-slate-500" aria-hidden />
          <span className="text-sm text-slate-600">Vincula el WhatsApp de la barbería escaneando un código, como en WhatsApp Web.</span>
          <Button className="ml-auto" loading={busy} onClick={() => void start()}>
            {qr ? <RefreshCw aria-hidden /> : <QrCode aria-hidden />} Mostrar código QR
          </Button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Usa un número dedicado a la barbería. Cognira solo envía mensajes de servicio (confirmaciones, recordatorios y cambios de cita), con pausas
        entre mensajes. Es una conexión no oficial de WhatsApp: si el número se desvincula, los mensajes quedan para enviarse a mano.
      </p>
    </div>
  );
}
