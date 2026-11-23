import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  isRetryableStatus,
  ProviderError,
  readError,
  type Fetch,
  type OutgoingMessage,
  type Sender,
  type SendResult,
} from './types';

/** wa.me: sin API. Genera el enlace prellenado y deja el mensaje "manual" para enviarlo desde el panel. */
export class WaMeSender implements Sender {
  readonly name = 'wa_me';
  send(msg: OutgoingMessage): Promise<SendResult> {
    const digits = msg.to.replace(/\D/g, '');
    return Promise.resolve({
      status: 'manual',
      providerMessageId: null,
      actionUrl: `https://wa.me/${digits}?text=${encodeURIComponent(msg.body)}`,
    });
  }
}

/** Desarrollo local sin credenciales: imprime el mensaje en consola. */
export class ConsoleSender implements Sender {
  private readonly logger = new Logger('Mensajes');
  constructor(readonly name: string) {}
  send(msg: OutgoingMessage): Promise<SendResult> {
    this.logger.log(
      `[${this.name}] → ${msg.to}${msg.subject ? ` · ${msg.subject}` : ''}\n${msg.body}`,
    );
    return Promise.resolve({ status: 'sent', providerMessageId: `console-${randomUUID()}` });
  }
}

/** Email con Resend. https://resend.com/docs/api-reference/emails/send-email */
export class ResendSender implements Sender {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: Fetch,
  ) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject ?? '',
          text: msg.body,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderError(`Sin conexión con Resend: ${(e as Error).message}`, true);
    }
    if (!res.ok)
      throw new ProviderError(
        await readError(res),
        isRetryableStatus(res.status),
        String(res.status),
      );
    const j = (await res.json()) as { id?: string };
    return { status: 'sent', providerMessageId: j.id ?? null };
  }
}
