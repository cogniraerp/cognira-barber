import { WaMeSender } from './simple';
import { ProviderError, type OutgoingMessage, type SendResult, type Sender } from './types';

type Fetch = typeof fetch;

/** Credenciales guardadas (cifradas) de una barbería con Evolution: solo el nombre de su instancia. */
export interface EvolutionCredentials {
  instanceName: string;
}

export type EvolutionState = 'open' | 'connecting' | 'close' | 'missing';

export interface QrResult {
  state: EvolutionState;
  /** data:image/png;base64,… (solo mientras no esté conectado). */
  qr: string | null;
  /** Código para vincular sin cámara (opcional en Evolution). */
  pairingCode: string | null;
  phone: string | null;
}

/** Nombre estable de la instancia de una barbería (Evolution admite letras, números y guiones). */
export const instanceNameFor = (barbershopId: string) => `cognira-${barbershopId}`;

/** "51987654321@s.whatsapp.net" → "+51987654321". */
export const jidToPhone = (jid: string | null | undefined) => {
  const d = (jid ?? '').split('@')[0]?.replace(/\D/g, '') ?? '';
  return d ? `+${d}` : null;
};

/** Cliente mínimo de Evolution API v2 (verificado contra v2.3.7). */
export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: Fetch,
  ) {}

  get configured(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T | null }> {
    if (!this.configured)
      throw new ProviderError('WhatsApp por QR no está configurado (EVOLUTION_URL)', false);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: { apikey: this.apiKey, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderError(`Sin conexión con Evolution: ${(e as Error).message}`, true);
    }
    if (res.status === 401)
      throw new ProviderError('Evolution rechazó la clave (EVOLUTION_API_KEY)', false, '401');
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data };
  }

  async state(instance: string): Promise<EvolutionState> {
    const r = await this.call<{ instance?: { state?: string } }>(
      'GET',
      `/instance/connectionState/${encodeURIComponent(instance)}`,
    );
    if (r.status === 404) return 'missing';
    const s = r.data?.instance?.state;
    return s === 'open' || s === 'connecting' ? s : 'close';
  }

  async phone(instance: string): Promise<string | null> {
    const r = await this.call<Array<{ ownerJid?: string | null }>>(
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
    );
    return jidToPhone(Array.isArray(r.data) ? r.data[0]?.ownerJid : null);
  }

  /** Crea la instancia si no existe y devuelve el QR para vincular (o el número, si ya está conectada). */
  async qr(instance: string): Promise<QrResult> {
    let state = await this.state(instance);
    type Qr = {
      base64?: string;
      pairingCode?: string | null;
      qrcode?: { base64?: string; pairingCode?: string | null };
    };
    let data: Qr | null = null;
    if (state === 'missing') {
      const r = await this.call<Qr>('POST', '/instance/create', {
        instanceName: instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      });
      if (r.status >= 400)
        throw new ProviderError(
          `Evolution no pudo crear la instancia (${r.status})`,
          r.status >= 500,
        );
      data = r.data;
      state = 'connecting';
    } else if (state !== 'open') {
      data = (await this.call<Qr>('GET', `/instance/connect/${encodeURIComponent(instance)}`)).data;
    }
    if (state === 'open')
      return { state, qr: null, pairingCode: null, phone: await this.phone(instance) };
    const base64 = data?.qrcode?.base64 ?? data?.base64 ?? null;
    const pairing = data?.qrcode?.pairingCode ?? data?.pairingCode ?? null;
    return {
      state,
      qr: base64 && base64.startsWith('data:image/') ? base64 : null,
      pairingCode: pairing && pairing !== 'None' ? pairing : null,
      phone: null,
    };
  }

  async logout(instance: string): Promise<void> {
    const r = await this.call('DELETE', `/instance/logout/${encodeURIComponent(instance)}`);
    if (r.status >= 500)
      throw new ProviderError(`Evolution no pudo cerrar la sesión (${r.status})`, true);
  }

  async sendText(instance: string, toDigits: string, text: string): Promise<string | null> {
    const r = await this.call<{ key?: { id?: string } }>(
      'POST',
      `/message/sendText/${encodeURIComponent(instance)}`,
      { number: toDigits, text },
    );
    if (r.status >= 400)
      throw new ProviderError(
        `Evolution no pudo enviar (${r.status})`,
        r.status >= 502,
        String(r.status),
      );
    return r.data?.key?.id ?? null;
  }
}

/** Separación mínima entre mensajes de un mismo número (reduce el riesgo de bloqueo de WhatsApp). */
const MIN_GAP_MS = 2500;
const lastSend = new Map<string, number>();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envía por el WhatsApp vinculado con QR. Si el número no está conectado, no se pierde el mensaje:
 * queda como envío manual (enlace wa.me), igual que sin proveedor.
 */
export class EvolutionSender implements Sender {
  readonly name = 'evolution';

  constructor(
    private readonly client: EvolutionClient,
    private readonly instance: string,
    private readonly gapMs = MIN_GAP_MS,
  ) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const state = await this.client.state(this.instance);
    if (state !== 'open') return new WaMeSender().send(msg);
    const since = Date.now() - (lastSend.get(this.instance) ?? 0);
    if (since < this.gapMs) await wait(this.gapMs - since);
    lastSend.set(this.instance, Date.now());
    const id = await this.client.sendText(this.instance, msg.to.replace(/\D/g, ''), msg.body);
    return { status: 'sent', providerMessageId: id };
  }

  /** Para "Probar conexión": conectado y con número. */
  async verify(): Promise<{ displayPhone: string; name: string | null }> {
    const state = await this.client.state(this.instance);
    if (state !== 'open')
      throw new ProviderError('El WhatsApp no está conectado: escanea el QR', false);
    return { displayPhone: (await this.client.phone(this.instance)) ?? '', name: null };
  }
}
