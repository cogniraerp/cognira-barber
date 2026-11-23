import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  GatewayHttpError,
  InvalidSignatureError,
  type ShopGateway,
  type WebhookInput,
} from './types';

const API = 'https://api.mercadopago.com';

export const MercadoPagoCredentials = z.object({
  /** Access token de la cuenta (APP_USR-… en producción, TEST-… en pruebas). */
  accessToken: z
    .string()
    .trim()
    .regex(/^(APP_USR|TEST)-[\w-]{20,}$/, 'Access token de Mercado Pago inválido'),
  /** Clave secreta de webhooks (Tus integraciones → Webhooks). Opcional pero recomendada. */
  webhookSecret: z.string().trim().max(200).optional(),
});
export type MercadoPagoCredentials = z.infer<typeof MercadoPagoCredentials>;

interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
  payment_type_id?: string;
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new GatewayHttpError(`Mercado Pago no respondió: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new GatewayHttpError(
      res.status === 401
        ? 'Mercado Pago rechazó el access token'
        : `Mercado Pago respondió ${res.status}${body.message ? `: ${body.message}` : ''}`,
      res.status,
    );
  }
  return (await res.json()) as T;
}

/**
 * Mercado Pago (Checkout Pro): una preferencia por cobro → link de pago (y QR con ese link).
 * El cliente paga con tarjeta, Yape u otros medios que tenga habilitados la cuenta.
 */
export const mercadoPago: ShopGateway<MercadoPagoCredentials> = {
  id: 'mercadopago',
  name: 'Mercado Pago',
  devOnly: false,
  credentials: MercadoPagoCredentials,
  fields: [
    {
      key: 'accessToken',
      label: 'Access token',
      required: true,
      secret: true,
      help: 'Mercado Pago → Tus integraciones → tu aplicación → Credenciales. Usa el de prueba (TEST-…) para practicar.',
    },
    {
      key: 'webhookSecret',
      label: 'Clave secreta de webhooks',
      required: false,
      secret: true,
      help: 'Tus integraciones → Webhooks. Con ella verificamos que cada aviso viene de Mercado Pago.',
    },
  ],
  publicInfo: (c) => ({
    token: `${c.accessToken.slice(0, 8)}…${c.accessToken.slice(-4)}`,
    webhookSignature: c.webhookSecret ? 'sí' : 'no',
  }),
  modeOf: (c) => (c.accessToken.startsWith('TEST-') ? 'test' : 'live'),

  async verify(c) {
    const me = await call<{ id: number; nickname?: string; site_id?: string }>(
      c.accessToken,
      '/users/me',
    );
    return { account: me.nickname ?? String(me.id) };
  },

  async createCharge(c, req) {
    const pref = await call<{ id: string; init_point: string; sandbox_init_point?: string }>(
      c.accessToken,
      '/checkout/preferences',
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': req.chargeId },
        body: JSON.stringify({
          items: [
            {
              id: req.chargeId,
              title: req.description,
              quantity: 1,
              unit_price: req.amountCents / 100,
              currency_id: req.currency,
            },
          ],
          external_reference: req.chargeId,
          notification_url: req.notificationUrl,
          expires: true,
          expiration_date_to: req.expiresAt.toISOString(),
          ...(req.backUrl
            ? {
                back_urls: { success: req.backUrl, pending: req.backUrl, failure: req.backUrl },
                auto_return: 'approved',
              }
            : {}),
        }),
      },
    );
    const url = c.accessToken.startsWith('TEST-')
      ? (pref.sandbox_init_point ?? pref.init_point)
      : pref.init_point;
    return { providerRef: pref.id, checkoutUrl: url };
  },

  async fetchStatus(c, charge, hint) {
    let payments: MpPayment[];
    if (hint?.paymentId) {
      payments = [
        await call<MpPayment>(c.accessToken, `/v1/payments/${encodeURIComponent(hint.paymentId)}`),
      ];
    } else {
      const r = await call<{ results: MpPayment[] }>(
        c.accessToken,
        `/v1/payments/search?external_reference=${encodeURIComponent(charge.id)}&sort=date_created&criteria=desc`,
      );
      payments = r.results ?? [];
    }
    // Solo cuenta un pago de ESTE cobro, aprobado y por el monto exacto.
    const mine = payments.filter((p) => p.external_reference === charge.id);
    const ok = mine.find(
      (p) =>
        p.status === 'approved' &&
        Math.round((p.transaction_amount ?? 0) * 100) === charge.amountCents &&
        (!p.currency_id || p.currency_id === charge.currency),
    );
    const last = ok ?? mine[0];
    return {
      status: ok ? 'paid' : 'pending',
      paymentId: ok ? String(ok.id) : null,
      detail: last
        ? {
            paymentId: String(last.id),
            status: last.status,
            statusDetail: last.status_detail,
            method: last.payment_method_id,
          }
        : undefined,
    };
  },

  async refund(c, req) {
    const r = await call<{ id: number | string; status?: string }>(
      c.accessToken,
      `/v1/payments/${encodeURIComponent(req.paymentId)}/refunds`,
      {
        method: 'POST',
        headers: { 'X-Idempotency-Key': req.idempotencyKey },
        body: JSON.stringify({ amount: req.amountCents / 100 }),
      },
    );
    if (r.status && !['approved', 'in_process'].includes(r.status))
      throw new GatewayHttpError(`Mercado Pago no aprobó la devolución (${r.status})`);
    return { refundId: String(r.id) };
  },

  async resolveChargeId(c, hint) {
    if (!hint.paymentId) return null;
    const p = await call<MpPayment>(
      c.accessToken,
      `/v1/payments/${encodeURIComponent(hint.paymentId)}`,
    );
    return p.external_reference ?? null;
  },

  parseWebhook(c, input) {
    const body = (input.body ?? {}) as { type?: string; action?: string; data?: { id?: unknown } };
    const q = input.query;
    const type = body.type ?? (q.type as string) ?? (q.topic as string);
    const raw = body.data?.id ?? q['data.id'] ?? q.id;
    const dataId = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    if (type !== 'payment' || !dataId) return null;
    if (c.webhookSecret) verifySignature(c.webhookSecret, dataId, input);
    return { paymentId: dataId };
  },
};

/**
 * Firma de Mercado Pago: header x-signature "ts=…,v1=…" = HMAC-SHA256 con la clave secreta de
 * "id:{data.id};request-id:{x-request-id};ts:{ts};" (data.id en minúsculas si es alfanumérico).
 */
export function verifySignature(secret: string, dataId: string, input: WebhookInput): void {
  const header = String(input.headers['x-signature'] ?? '');
  const requestId = String(input.headers['x-request-id'] ?? '');
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=').map((x) => x.trim()) as [string, string]),
  );
  if (!parts.ts || !parts.v1) throw new InvalidSignatureError('Falta la firma x-signature');
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new InvalidSignatureError('Firma de Mercado Pago inválida');
}
