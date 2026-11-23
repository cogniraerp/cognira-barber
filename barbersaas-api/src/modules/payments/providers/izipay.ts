import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  GatewayHttpError,
  InvalidSignatureError,
  type ShopGateway,
  type WebhookHint,
  type WebhookInput,
} from './types';

/**
 * Izipay (micuentaweb, REST V4). Auth Basic `usuario:contraseña` del Back Office → Configuración →
 * Tienda → Claves de API REST.
 *
 * Verificado con los ejemplos oficiales (github.com/izipay-pe): URL base, Basic auth,
 * `Charge/CreatePaymentOrder` → `answer.paymentURL` y la firma del IPN (`kr-hash` = HMAC-SHA256
 * de `kr-answer` con la contraseña). `Order/Get`, `Transaction/Get` y `Transaction/CancelOrRefund`
 * siguen el formato estándar de la REST V4: validar con la cuenta de pruebas.
 */
export const IZIPAY_API = 'https://api.micuentaweb.pe/api-payment/V4';

export const IzipayCredentials = z.object({
  /** Usuario (identificador de la tienda). */
  shopId: z
    .string()
    .trim()
    .regex(/^\d{6,10}$/, 'Usuario de Izipay inválido (es un número de 8 dígitos)'),
  /** Contraseña de la API REST (testpassword_… en pruebas). */
  password: z.string().trim().min(10, 'Contraseña de Izipay inválida').max(200),
});
export type IzipayCredentials = z.infer<typeof IzipayCredentials>;

interface IzipayResponse<T> {
  /** 'SUCCESS' o 'ERROR'. */
  status: string;
  answer: T & {
    errorCode?: string;
    errorMessage?: string;
    detailedErrorMessage?: string | null;
  };
}

export interface IzipayTransaction {
  uuid: string;
  status?: string;
  detailedStatus?: string;
  amount?: number;
  currency?: string;
  orderDetails?: { orderId?: string | null };
  transactionDetails?: { cardDetails?: { effectiveBrand?: string } };
}

export class IzipayError extends GatewayHttpError {
  constructor(
    message: string,
    readonly code?: string,
    status?: number,
  ) {
    super(message, status);
  }
}

async function call<T>(c: IzipayCredentials, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${IZIPAY_API}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.shopId}:${c.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new IzipayError(`Izipay no respondió: ${(e as Error).message}`);
  }
  if (res.status === 401)
    throw new IzipayError('Izipay rechazó el usuario o la contraseña', undefined, 401);
  const data = (await res.json().catch(() => null)) as IzipayResponse<T> | null;
  if (!res.ok || !data)
    throw new IzipayError(`Izipay respondió ${res.status}`, undefined, res.status);
  if (data.status !== 'SUCCESS') {
    const a = data.answer ?? {};
    const msg = a.detailedErrorMessage || a.errorMessage || 'error desconocido';
    throw new IzipayError(
      `Izipay: ${a.errorCode ? `${a.errorCode} ` : ''}${msg}`,
      a.errorCode,
      res.status,
    );
  }
  return data.answer;
}

/** Izipay espera la fecha con zona; Lima es UTC−5 todo el año (sin horario de verano). */
export function limaDateTime(d: Date): string {
  return `${new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 19)}-05:00`;
}

/** Pago válido de ESTE cobro: pagado y por el monto exacto (en céntimos, como lo da Izipay). */
export function findPaid(
  txs: IzipayTransaction[],
  charge: { id: string; amountCents: number; currency: string },
): IzipayTransaction | undefined {
  return txs.find(
    (t) =>
      t.status === 'PAID' &&
      t.amount === charge.amountCents &&
      (!t.currency || t.currency === charge.currency) &&
      (!t.orderDetails?.orderId || t.orderDetails.orderId === charge.id),
  );
}

/**
 * IPN de Izipay (form-urlencoded): `kr-hash` = HMAC-SHA256 hex del texto `kr-answer` tal cual llega,
 * con la contraseña de la API (`kr-hash-key=password`). El retorno del navegador usa otra clave
 * (`sha256_hmac`): no lo aceptamos como webhook.
 */
export function parseIzipayIpn(password: string, input: WebhookInput): WebhookHint | null {
  const body = (input.body ?? {}) as Record<string, unknown>;
  const answerRaw = body['kr-answer'];
  if (typeof answerRaw !== 'string' || !answerRaw) return null;
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const hash = str(body['kr-hash'], '').toLowerCase();
  const key = str(body['kr-hash-key'], 'password');
  if (key !== 'password')
    throw new InvalidSignatureError('El aviso de Izipay no viene firmado con la contraseña');
  const expected = createHmac('sha256', password).update(answerRaw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new InvalidSignatureError('Firma de Izipay inválida');

  let answer: {
    orderDetails?: { orderId?: unknown };
    orderId?: unknown;
    transactions?: Array<{ uuid?: unknown }>;
  };
  try {
    answer = JSON.parse(answerRaw) as typeof answer;
  } catch {
    return null;
  }
  const orderId = answer.orderDetails?.orderId ?? answer.orderId;
  const uuid = answer.transactions?.[0]?.uuid;
  const hint: WebhookHint = {};
  if (typeof orderId === 'string' && orderId) hint.chargeId = orderId;
  if (typeof uuid === 'string' && uuid) hint.paymentId = uuid;
  return hint.chargeId || hint.paymentId ? hint : null;
}

/**
 * Izipay (link de pago): un "payment order" por cobro → URL de pago (y QR con ese link). El cliente
 * paga con tarjeta, Yape u otros medios habilitados en la tienda. El IPN se configura en el Back
 * Office (Reglas de notificaciones → URL de notificación al final del pago).
 */
export const izipay: ShopGateway<IzipayCredentials> = {
  id: 'izipay',
  name: 'Izipay',
  devOnly: false,
  credentials: IzipayCredentials,
  fields: [
    {
      key: 'shopId',
      label: 'Usuario',
      required: true,
      secret: false,
      help: 'Back Office de Izipay → Configuración → Tienda → Claves de API REST → Usuario.',
    },
    {
      key: 'password',
      label: 'Contraseña',
      required: true,
      secret: true,
      help: 'En la misma sección. Usa la de prueba (testpassword_…) para practicar y la de producción para cobrar.',
    },
  ],
  publicInfo: (c) => ({
    user: c.shopId,
    password: `${c.password.slice(0, 13)}…${c.password.slice(-4)}`,
  }),
  modeOf: (c) => (c.password.startsWith('testpassword_') ? 'test' : 'live'),

  async verify(c) {
    await call<unknown>(c, 'Charge/SDKTest', { value: 'cognira' });
    return { account: `Tienda ${c.shopId}` };
  },

  async createCharge(c, req) {
    const back = req.backUrl
      ? { successUrl: req.backUrl, cancelUrl: req.backUrl, returnMode: 'GET' }
      : {};
    const r = await call<{ paymentOrderId?: string; paymentURL: string }>(
      c,
      'Charge/CreatePaymentOrder',
      {
        amount: req.amountCents,
        currency: req.currency,
        orderId: req.chargeId,
        expirationDate: limaDateTime(req.expiresAt),
        channelOptions: { channelType: 'URL' },
        ...back,
      },
    );
    if (!r.paymentURL) throw new IzipayError('Izipay no devolvió el link de pago');
    return { providerRef: r.paymentOrderId ?? req.chargeId, checkoutUrl: r.paymentURL };
  },

  async fetchStatus(c, charge) {
    // Siempre se consulta la orden por nuestro id: es la fuente de verdad, no el aviso.
    let txs: IzipayTransaction[];
    try {
      const r = await call<{ transactions?: IzipayTransaction[] }>(c, 'Order/Get', {
        orderId: charge.id,
      });
      txs = r.transactions ?? [];
    } catch (e) {
      // Sin intentos de pago la orden puede no existir aún: queda pendiente (nunca "pagado" por error).
      if (e instanceof IzipayError && e.status !== 401 && e.code)
        return { status: 'pending', paymentId: null, detail: { error: e.message } };
      throw e;
    }
    const ok = findPaid(txs, charge);
    const last = ok ?? txs[0];
    return {
      status: ok ? 'paid' : 'pending',
      paymentId: ok ? ok.uuid : null,
      detail: last
        ? {
            paymentId: last.uuid,
            status: last.status,
            statusDetail: last.detailedStatus,
            method: last.transactionDetails?.cardDetails?.effectiveBrand,
          }
        : undefined,
    };
  },

  async refund(c, req) {
    // Izipay no tiene clave de idempotencia. El servicio de reembolsos bloquea la fila, pero si la
    // respuesta se pierde (timeout) el reintento podría devolver dos veces un monto parcial: validar
    // en la cuenta de pruebas si Izipay rechaza el exceso sobre lo pagado.
    const r = await call<{ uuid?: string; status?: string; detailedStatus?: string }>(
      c,
      'Transaction/CancelOrRefund',
      { uuid: req.paymentId, amount: req.amountCents, currency: 'PEN', resolutionMode: 'AUTO' },
    );
    if (r.status === 'UNPAID' || r.detailedStatus === 'REFUSED')
      throw new IzipayError(`Izipay no aprobó la devolución (${r.detailedStatus ?? r.status})`);
    return { refundId: r.uuid ?? `izp_ref_${req.idempotencyKey.slice(0, 8)}` };
  },

  async resolveChargeId(c, hint) {
    if (hint.chargeId) return hint.chargeId;
    if (!hint.paymentId) return null;
    const t = await call<IzipayTransaction>(c, 'Transaction/Get', { uuid: hint.paymentId });
    return t.orderDetails?.orderId ?? null;
  },

  parseWebhook: (c, input) => parseIzipayIpn(c.password, input),
};
