import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IZIPAY_API, izipay, limaDateTime } from './izipay';
import { GatewayHttpError, InvalidSignatureError } from './types';

const creds = { shopId: '12345678', password: 'testpassword_abcdefghijklmnop' };
const charge = {
  id: '11111111-2222-3333-4444-555555555555',
  amountCents: 3000,
  currency: 'PEN',
  providerRef: 'po_1',
};

const ipn = (answer: unknown, password = creds.password, key = 'password') => {
  const raw = JSON.stringify(answer);
  return {
    'kr-answer': raw,
    'kr-hash': createHmac('sha256', password).update(raw).digest('hex'),
    'kr-hash-key': key,
    'kr-hash-algorithm': 'sha256_hmac',
    'kr-answer-type': 'V4/Payment',
  };
};

const ok = (answer: unknown) =>
  new Response(JSON.stringify({ status: 'SUCCESS', answer }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('Izipay', () => {
  it('valida credenciales y deduce el modo', () => {
    expect(izipay.credentials.safeParse({ shopId: 'abc', password: 'x' }).success).toBe(false);
    expect(izipay.modeOf(creds)).toBe('test');
    expect(izipay.modeOf({ ...creds, password: 'prodpassword_abcdefghijk' })).toBe('live');
    expect(izipay.publicInfo(creds).password).toBe('testpassword_…mnop');
  });

  it('fecha de expiración en hora de Lima', () => {
    expect(limaDateTime(new Date('2026-11-21T20:30:00Z'))).toBe('2026-11-21T15:30:00-05:00');
  });

  it('IPN: verifica la firma con la contraseña y extrae cobro y transacción', () => {
    const body = ipn({
      orderStatus: 'PAID',
      orderDetails: { orderId: charge.id },
      transactions: [{ uuid: 'tx-1' }],
    });
    expect(izipay.parseWebhook(creds, { body, query: {}, headers: {} })).toEqual({
      chargeId: charge.id,
      paymentId: 'tx-1',
    });
  });

  it('IPN: rechaza firmas inválidas, adulteradas o con la clave del navegador', () => {
    const answer = { orderDetails: { orderId: charge.id } };
    const bad = ipn(answer, 'otra-clave');
    expect(() => izipay.parseWebhook(creds, { body: bad, query: {}, headers: {} })).toThrow(
      InvalidSignatureError,
    );
    const tampered = {
      ...ipn(answer),
      'kr-answer': JSON.stringify({ orderDetails: { orderId: 'x' } }),
    };
    expect(() => izipay.parseWebhook(creds, { body: tampered, query: {}, headers: {} })).toThrow(
      InvalidSignatureError,
    );
    const browser = ipn(answer, creds.password, 'sha256_hmac');
    expect(() => izipay.parseWebhook(creds, { body: browser, query: {}, headers: {} })).toThrow(
      InvalidSignatureError,
    );
    expect(izipay.parseWebhook(creds, { body: {}, query: {}, headers: {} })).toBeNull();
  });

  it('crea el link de pago con Basic auth, céntimos y retorno', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(ok({ paymentOrderId: 'po_9', paymentURL: 'https://pay/x' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await izipay.createCharge(creds, {
      chargeId: charge.id,
      amountCents: 3000,
      currency: 'PEN',
      description: 'Corte',
      notificationUrl: 'https://api/wh',
      expiresAt: new Date('2026-11-21T20:30:00Z'),
      backUrl: 'https://web/back',
    });
    expect(r).toEqual({ providerRef: 'po_9', checkoutUrl: 'https://pay/x' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IZIPAY_API}/Charge/CreatePaymentOrder`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('12345678:testpassword_abcdefghijklmnop').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 3000,
      currency: 'PEN',
      orderId: charge.id,
      expirationDate: '2026-11-21T15:30:00-05:00',
      channelOptions: { channelType: 'URL' },
      successUrl: 'https://web/back',
      returnMode: 'GET',
    });
  });

  it('un error de Izipay (status ERROR) se convierte en GatewayHttpError legible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'ERROR',
              answer: { errorCode: 'INT_009', errorMessage: 'invalid amount' },
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    await expect(izipay.verify(creds)).rejects.toThrow(GatewayHttpError);
    await expect(izipay.verify(creds)).rejects.toThrow('INT_009 invalid amount');
  });

  it('estado: solo cuenta un pago PAID de este cobro y por el monto exacto', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      ok({ transactions: [{ uuid: 't1', status: 'PAID', amount: 2999, currency: 'PEN' }] }),
    );
    expect((await izipay.fetchStatus(creds, charge)).status).toBe('pending');
    fetchMock.mockResolvedValueOnce(
      ok({
        transactions: [
          { uuid: 't0', status: 'UNPAID', amount: 3000, currency: 'PEN' },
          {
            uuid: 't2',
            status: 'PAID',
            amount: 3000,
            currency: 'PEN',
            orderDetails: { orderId: charge.id },
          },
        ],
      }),
    );
    expect(await izipay.fetchStatus(creds, charge)).toMatchObject({
      status: 'paid',
      paymentId: 't2',
    });
    // Orden aún sin intentos: queda pendiente, no revienta.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'ERROR',
          answer: { errorCode: 'PSP_010', errorMessage: 'not found' },
        }),
      ),
    );
    expect((await izipay.fetchStatus(creds, charge)).status).toBe('pending');
    // Credenciales rechazadas: sí es un error.
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(izipay.fetchStatus(creds, charge)).rejects.toThrow('rechazó');
  });

  it('reembolso por CancelOrRefund', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ uuid: 'ref-1', status: 'PAID' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await izipay.refund(creds, {
        paymentId: 't2',
        amountCents: 1500,
        idempotencyKey: 'refund-1',
      }),
    ).toEqual({
      refundId: 'ref-1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${IZIPAY_API}/Transaction/CancelOrRefund`);
    expect(JSON.parse(init.body as string)).toEqual({
      uuid: 't2',
      amount: 1500,
      currency: 'PEN',
      resolutionMode: 'AUTO',
    });
  });

  it('resuelve el cobro desde el aviso firmado sin llamar a la API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await izipay.resolveChargeId(creds, { chargeId: charge.id })).toBe(charge.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
