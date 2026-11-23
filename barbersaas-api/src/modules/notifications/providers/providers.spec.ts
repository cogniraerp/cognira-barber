import { describe, expect, it } from 'vitest';
import { WaMeSender, ResendSender } from './simple';
import { twilioSignature, TwilioSender, verifyTwilioSignature } from './twilio';
import { ProviderError, type Fetch } from './types';
import { WhatsAppCloudSender } from './whatsapp-cloud';

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
  }) as unknown as Fetch;
  return { fn, calls };
}

const cloudCreds = { phoneNumberId: '1111', wabaId: '2222', accessToken: 'EAAG-token' };

describe('WhatsApp Cloud API', () => {
  it('texto: URL, auth y payload', async () => {
    const f = fakeFetch([{ status: 200, body: { messages: [{ id: 'wamid.ABC' }] } }]);
    const r = await new WhatsAppCloudSender(cloudCreds, f.fn, 'v21.0').send({
      to: '+51987654321',
      body: 'Hola',
    });
    expect(r).toEqual({ status: 'sent', providerMessageId: 'wamid.ABC' });
    expect(f.calls[0]!.url).toBe('https://graph.facebook.com/v21.0/1111/messages');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer EAAG-token',
    );
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '51987654321',
      type: 'text',
      text: { body: 'Hola', preview_url: true },
    });
  });

  it('plantilla aprobada con parámetros posicionales', async () => {
    const f = fakeFetch([{ status: 200, body: { messages: [{ id: 'wamid.T' }] } }]);
    await new WhatsAppCloudSender(cloudCreds, f.fn, 'v21.0').send({
      to: '+51987654321',
      body: '',
      template: { name: 'bs_reminder', language: 'es', params: ['Ana', '10:00'] },
    });
    expect(JSON.parse(f.calls[0]!.init.body as string).template).toEqual({
      name: 'bs_reminder',
      language: { code: 'es' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ana' },
            { type: 'text', text: '10:00' },
          ],
        },
      ],
    });
  });

  it('errores: 4xx no reintentable (con el mensaje de Meta), 429/5xx sí', async () => {
    const s = (status: number) =>
      new WhatsAppCloudSender(
        cloudCreds,
        fakeFetch([{ status, body: { error: { message: 'Re-engagement message', code: 131047 } } }])
          .fn,
        'v21.0',
      );
    await expect(s(400).send({ to: '+51', body: 'x' })).rejects.toMatchObject({
      retryable: false,
      message: 'Re-engagement message',
    });
    await expect(s(429).send({ to: '+51', body: 'x' })).rejects.toMatchObject({ retryable: true });
    await expect(s(503).send({ to: '+51', body: 'x' })).rejects.toBeInstanceOf(ProviderError);
  });

  it('verify y envío de plantilla a aprobación', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: { display_phone_number: '+51 1 555 0000', verified_name: 'Barbería Demo' },
      },
      { status: 200, body: { id: 'tpl1', status: 'PENDING' } },
    ]);
    const s = new WhatsAppCloudSender(cloudCreds, f.fn, 'v21.0');
    expect(await s.verify()).toEqual({ displayPhone: '+51 1 555 0000', name: 'Barbería Demo' });
    expect(
      await s.submitTemplate({
        name: 'bs_x',
        language: 'es',
        body: 'Hola {{1}}',
        examples: ['Ana'],
      }),
    ).toEqual({ id: 'tpl1', status: 'PENDING' });
    expect(f.calls[1]!.url).toBe('https://graph.facebook.com/v21.0/2222/message_templates');
  });
});

describe('Twilio', () => {
  it('envía por formulario con Basic auth y StatusCallback', async () => {
    const f = fakeFetch([{ status: 201, body: { sid: 'SM123' } }]);
    const r = await new TwilioSender(
      { accountSid: 'AC1', authToken: 'tok', fromNumber: '+14155550000' },
      f.fn,
      'https://api.x/v1/webhooks/twilio',
    ).send({ to: '+51987654321', body: 'Hola' });
    expect(r.providerMessageId).toBe('SM123');
    const body = new URLSearchParams(f.calls[0]!.init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      From: 'whatsapp:+14155550000',
      To: 'whatsapp:+51987654321',
      Body: 'Hola',
      StatusCallback: 'https://api.x/v1/webhooks/twilio',
    });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC1:tok').toString('base64')}`,
    );
  });

  it('firma de webhooks (ejemplo de la documentación de Twilio)', () => {
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+12349013030',
      Digits: '1234',
      From: '+12349013030',
      To: '+18005551212',
    };
    expect(twilioSignature('12345', url, params)).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(verifyTwilioSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true);
    expect(
      verifyTwilioSignature(
        '12345',
        url,
        { ...params, Digits: '9' },
        '0/KCTR6DLpKmkAf8muzZqo1nDgQ=',
      ),
    ).toBe(false);
  });
});

describe('wa.me y Resend', () => {
  it('wa.me genera el enlace prellenado', async () => {
    expect(await new WaMeSender().send({ to: '+51987654321', body: 'Hola Ana 👋' })).toEqual({
      status: 'manual',
      providerMessageId: null,
      actionUrl: 'https://wa.me/51987654321?text=Hola%20Ana%20%F0%9F%91%8B',
    });
  });
  it('Resend', async () => {
    const f = fakeFetch([{ status: 200, body: { id: 'em_1' } }]);
    const r = await new ResendSender('re_key', 'BarberSaaS <no-reply@x.pe>', f.fn).send({
      to: 'a@b.pe',
      subject: 'Hola',
      body: 'Texto',
    });
    expect(r.providerMessageId).toBe('em_1');
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({
      from: 'BarberSaaS <no-reply@x.pe>',
      to: ['a@b.pe'],
      subject: 'Hola',
      text: 'Texto',
    });
  });
});
