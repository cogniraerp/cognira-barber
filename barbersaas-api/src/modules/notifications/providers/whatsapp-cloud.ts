import {
  isRetryableStatus,
  ProviderError,
  readError,
  type CloudApiCredentials,
  type Fetch,
  type OutgoingMessage,
  type Sender,
  type SendResult,
} from './types';

/** WhatsApp Cloud API (Meta Graph). https://developers.facebook.com/docs/whatsapp/cloud-api */
export class WhatsAppCloudSender implements Sender {
  readonly name = 'cloud_api';

  constructor(
    private readonly creds: CloudApiCredentials,
    private readonly fetchFn: Fetch,
    private readonly graphVersion: string,
  ) {}

  private url(path: string): string {
    return `https://graph.facebook.com/${this.graphVersion}/${path}`;
  }

  private async call(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url(path), {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.creds.accessToken}`,
          'content-type': 'application/json',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ProviderError(`Sin conexión con Meta: ${(e as Error).message}`, true);
    }
    if (!res.ok)
      throw new ProviderError(
        await readError(res),
        isRetryableStatus(res.status),
        String(res.status),
      );
    return res.json();
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const to = msg.to.replace(/^\+/, '');
    const payload = msg.template
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: msg.template.name,
            language: { code: msg.template.language },
            components: [
              {
                type: 'body',
                parameters: msg.template.params.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: msg.body, preview_url: true },
        };
    const r = (await this.call(`${this.creds.phoneNumberId}/messages`, {
      method: 'POST',
      body: payload,
    })) as { messages?: Array<{ id: string }> };
    return { status: 'sent', providerMessageId: r.messages?.[0]?.id ?? null };
  }

  async verify(): Promise<{ displayPhone: string; name: string | null }> {
    const r = (await this.call(
      `${this.creds.phoneNumberId}?fields=display_phone_number,verified_name`,
      { method: 'GET' },
    )) as {
      display_phone_number?: string;
      verified_name?: string;
    };
    if (!r.display_phone_number) throw new ProviderError('Respuesta inesperada de Meta', false);
    return { displayPhone: r.display_phone_number, name: r.verified_name ?? null };
  }

  /** Envía una plantilla a aprobación (categoría UTILITY). Los parámetros van como {{1}}, {{2}}… */
  async submitTemplate(t: {
    name: string;
    language: string;
    body: string;
    examples: string[];
  }): Promise<{ id: string; status: string }> {
    const r = (await this.call(`${this.creds.wabaId}/message_templates`, {
      method: 'POST',
      body: {
        name: t.name,
        language: t.language,
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: t.body,
            ...(t.examples.length ? { example: { body_text: [t.examples] } } : {}),
          },
        ],
      },
    })) as { id: string; status: string };
    return r;
  }
}
