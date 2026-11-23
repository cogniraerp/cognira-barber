export const HTTP_FETCH = Symbol('HTTP_FETCH');
export type Fetch = typeof fetch;

export interface OutgoingMessage {
  /** E.164 (+51987…) para WhatsApp; email para email. */
  to: string;
  body: string;
  subject?: string;
  /** Plantilla aprobada por Meta (mensajes iniciados por la empresa fuera de la ventana de 24 h). */
  template?: { name: string; language: string; params: string[] };
}

export interface SendResult {
  status: 'sent' | 'manual';
  providerMessageId: string | null;
  /** wa.me: enlace para que alguien lo envíe a mano. */
  actionUrl?: string;
}

export interface Sender {
  readonly name: string;
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/** `retryable`: errores transitorios (429, 5xx, red) se reintentan; los 4xx no. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface CloudApiCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
}
export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: { message?: string; code?: number }; message?: string };
    return j.error?.message ?? j.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || `HTTP ${res.status}`;
  }
}

export const isRetryableStatus = (s: number) => s === 429 || s >= 500;
