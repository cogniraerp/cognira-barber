import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mercadoPago, verifySignature } from './mercadopago';
import { InvalidSignatureError } from './types';

const creds = { accessToken: 'TEST-1234567890-abcdefghijklmnopqrstuvwxyz', webhookSecret: 'shh' };
const charge = {
  id: '11111111-2222-3333-4444-555555555555',
  amountCents: 3000,
  currency: 'PEN',
  providerRef: 'pref_1',
};

const signed = (dataId: string, secret = 'shh', ts = '1700000000', requestId = 'req-1') => {
  const v1 = createHmac('sha256', secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
};

afterEach(() => vi.unstubAllGlobals());

describe('Mercado Pago', () => {
  it('valida credenciales y deduce el modo', () => {
    expect(mercadoPago.credentials.safeParse({ accessToken: 'nope' }).success).toBe(false);
    expect(mercadoPago.modeOf(creds)).toBe('test');
    expect(mercadoPago.modeOf({ accessToken: 'APP_USR-1234567890-abcdefghijklmnopqrstu' })).toBe(
      'live',
    );
    expect(mercadoPago.publicInfo(creds).token).toBe('TEST-123…wxyz');
  });

  it('webhook: toma el id del pago y verifica la firma', () => {
    const body = { type: 'payment', data: { id: '987' } };
    expect(mercadoPago.parseWebhook(creds, { body, query: {}, headers: signed('987') })).toEqual({
      paymentId: '987',
    });
    expect(() =>
      mercadoPago.parseWebhook(creds, { body, query: {}, headers: signed('987', 'otra') }),
    ).toThrow(InvalidSignatureError);
    expect(() => mercadoPago.parseWebhook(creds, { body, query: {}, headers: {} })).toThrow(
      InvalidSignatureError,
    );
    // Otros eventos se ignoran; sin clave secreta no se exige firma.
    expect(
      mercadoPago.parseWebhook(creds, {
        body: { type: 'merchant_order', data: { id: '1' } },
        query: {},
        headers: {},
      }),
    ).toBeNull();
    expect(
      mercadoPago.parseWebhook(
        { accessToken: creds.accessToken },
        { body: {}, query: { type: 'payment', 'data.id': '5' }, headers: {} },
      ),
    ).toEqual({ paymentId: '5' });
    expect(() =>
      verifySignature('shh', 'ABC', { body: {}, query: {}, headers: signed('abc') }),
    ).not.toThrow();
  });

  it('estado: solo cuenta un pago aprobado de este cobro y por el monto exacto', async () => {
    const pay = (over: object) => ({
      id: 1,
      status: 'approved',
      external_reference: charge.id,
      transaction_amount: 30,
      currency_id: 'PEN',
      ...over,
    });
    const stub = (results: object[]) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(JSON.stringify({ results })))),
      );
    stub([pay({})]);
    expect(await mercadoPago.fetchStatus(creds, charge)).toMatchObject({
      status: 'paid',
      paymentId: '1',
    });
    stub([pay({ transaction_amount: 29 })]);
    expect((await mercadoPago.fetchStatus(creds, charge)).status).toBe('pending');
    stub([pay({ external_reference: 'otro' })]);
    expect((await mercadoPago.fetchStatus(creds, charge)).status).toBe('pending');
    stub([pay({ status: 'rejected', status_detail: 'cc_rejected_other_reason' })]);
    expect(await mercadoPago.fetchStatus(creds, charge)).toMatchObject({
      status: 'pending',
      detail: { status: 'rejected' },
    });
  });

  it('crea la preferencia con referencia externa, vencimiento y webhook', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'pref_9',
            init_point: 'https://mp/live',
            sandbox_init_point: 'https://mp/sandbox',
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await mercadoPago.createCharge(creds, {
      chargeId: charge.id,
      amountCents: 3050,
      currency: 'PEN',
      description: 'Corte',
      notificationUrl: 'https://api/webhooks/payments/tok',
      expiresAt: new Date('2026-11-09T12:00:00Z'),
    });
    expect(r).toEqual({ providerRef: 'pref_9', checkoutUrl: 'https://mp/sandbox' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      items: [{ unit_price: 30.5, currency_id: 'PEN', quantity: 1 }],
      external_reference: charge.id,
      notification_url: 'https://api/webhooks/payments/tok',
      expiration_date_to: '2026-11-09T12:00:00.000Z',
    });
  });

  it('un 401 de la pasarela se traduce a un mensaje claro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    await expect(mercadoPago.verify(creds)).rejects.toThrow('Mercado Pago rechazó el access token');
  });

  it('devolución: POST /refunds con monto e idempotencia; un rechazo es error', async () => {
    const fetchMock = vi.fn((_u: string, _i?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ id: 55, status: 'approved' }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await mercadoPago.refund(creds, {
        paymentId: '777',
        amountCents: 1750,
        idempotencyKey: 'ref-1',
      }),
    ).toEqual({ refundId: '55' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.mercadopago.com/v1/payments/777/refunds');
    expect(JSON.parse(init!.body as string)).toEqual({ amount: 17.5 });
    expect((init!.headers as Record<string, string>)['X-Idempotency-Key']).toBe('ref-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 56, status: 'rejected' })))),
    );
    await expect(
      mercadoPago.refund(creds, { paymentId: '777', amountCents: 100, idempotencyKey: 'ref-2' }),
    ).rejects.toThrow('no aprobó');
  });
});
