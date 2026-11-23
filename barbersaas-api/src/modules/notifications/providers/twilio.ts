import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  isRetryableStatus,
  ProviderError,
  readError,
  type Fetch,
  type OutgoingMessage,
  type Sender,
  type SendResult,
  type TwilioCredentials,
} from './types';

/** Twilio (WhatsApp). https://www.twilio.com/docs/whatsapp/api */
export class TwilioSender implements Sender {
  readonly name = 'twilio';

  constructor(
    private readonly creds: TwilioCredentials,
    private readonly fetchFn: Fetch,
    private readonly statusCallbackUrl: string,
  ) {}

  private auth(): string {
    return `Basic ${Buffer.from(`${this.creds.accountSid}:${this.creds.authToken}`).toString('base64')}`;
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const form = new URLSearchParams({
      From: `whatsapp:${this.creds.fromNumber}`,
      To: `whatsapp:${msg.to}`,
      Body: msg.body,
      StatusCallback: this.statusCallbackUrl,
    });
    let res: Response;
    try {
      res = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: this.auth(),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (e) {
      throw new ProviderError(`Sin conexión con Twilio: ${(e as Error).message}`, true);
    }
    if (!res.ok)
      throw new ProviderError(
        await readError(res),
        isRetryableStatus(res.status),
        String(res.status),
      );
    const j = (await res.json()) as { sid?: string };
    return { status: 'sent', providerMessageId: j.sid ?? null };
  }

  async verify(): Promise<{ displayPhone: string; name: string | null }> {
    const res = await this.fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}.json`,
      {
        headers: { authorization: this.auth() },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw new ProviderError(await readError(res), false, String(res.status));
    const j = (await res.json()) as { friendly_name?: string; status?: string };
    if (j.status && j.status !== 'active')
      throw new ProviderError(`Cuenta Twilio en estado "${j.status}"`, false);
    return { displayPhone: this.creds.fromNumber, name: j.friendly_name ?? null };
  }
}

/**
 * Firma de webhooks de Twilio: base64(HMAC-SHA1(authToken, url + claves ordenadas con sus valores)).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  given: string | undefined,
): boolean {
  if (!given) return false;
  const a = Buffer.from(twilioSignature(authToken, url, params));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
