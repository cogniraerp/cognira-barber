import { describe, expect, it, vi } from 'vitest';
import { SmtpSender } from './smtp';
import { ProviderError } from './types';

const cfg = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  user: 'a@gmail.com',
  pass: 'x',
  from: 'Cognira Barber <a@gmail.com>',
};

describe('SmtpSender', () => {
  it('envía texto plano desde el remitente configurado', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: '<abc@gmail.com>' });
    const r = await new SmtpSender(cfg, { sendMail }).send({
      to: 'b@test.pe',
      subject: 'Hola',
      body: 'Cuerpo',
    });
    expect(r).toEqual({ status: 'sent', providerMessageId: '<abc@gmail.com>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: cfg.from,
      to: 'b@test.pe',
      subject: 'Hola',
      text: 'Cuerpo',
    });
  });

  it('credenciales malas: error permanente; red caída: se reintenta', async () => {
    const auth = new SmtpSender(cfg, {
      sendMail: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }),
        ),
    });
    const err = (await auth
      .send({ to: 'b@test.pe', body: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(false);
    const net = new SmtpSender(cfg, {
      sendMail: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    });
    const err2 = (await net
      .send({ to: 'b@test.pe', body: 'x' })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err2.retryable).toBe(true);
  });
});
