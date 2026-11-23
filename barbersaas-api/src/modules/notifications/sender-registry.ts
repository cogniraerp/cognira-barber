import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { MessagingProvider } from '../../generated/prisma/enums';
import { ConsoleSender, ResendSender, WaMeSender } from './providers/simple';
import { TwilioSender } from './providers/twilio';
import {
  HTTP_FETCH,
  ProviderError,
  type CloudApiCredentials,
  type Fetch,
  type Sender,
  type TwilioCredentials,
} from './providers/types';
import { WhatsAppCloudSender } from './providers/whatsapp-cloud';

export interface WhatsAppConfigRow {
  provider: MessagingProvider;
  credentialsEnc: Uint8Array | null;
  keyVersion: number;
}

/** Elige y construye el "sender" según la configuración de la barbería (o de la plataforma). */
@Injectable()
export class SenderRegistry {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly fetchFn: Fetch,
    private readonly crypto: CryptoService,
  ) {}

  whatsapp(
    config: WhatsAppConfigRow | null,
  ): Sender & { verify?: () => Promise<{ displayPhone: string; name: string | null }> } {
    const provider = config?.provider ?? 'platform';
    switch (provider) {
      case 'wa_me':
        return new WaMeSender();
      case 'cloud_api':
        return new WhatsAppCloudSender(
          this.creds<CloudApiCredentials>(config),
          this.fetchFn,
          this.env.WHATSAPP_GRAPH_VERSION,
        );
      case 'twilio':
        return new TwilioSender(
          this.creds<TwilioCredentials>(config),
          this.fetchFn,
          `${this.env.PUBLIC_API_URL.replace(/\/$/, '')}/v1/webhooks/twilio`,
        );
      case 'platform':
        return this.platform();
    }
  }

  /** Número de la plataforma (planes sin API propia). Sin credenciales: consola en desarrollo, error en producción. */
  platform(): Sender {
    if (this.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID && this.env.WHATSAPP_PLATFORM_ACCESS_TOKEN) {
      return new WhatsAppCloudSender(
        {
          phoneNumberId: this.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID,
          wabaId: this.env.WHATSAPP_PLATFORM_WABA_ID,
          accessToken: this.env.WHATSAPP_PLATFORM_ACCESS_TOKEN,
        },
        this.fetchFn,
        this.env.WHATSAPP_GRAPH_VERSION,
      );
    }
    if (this.env.NODE_ENV === 'production')
      throw new ProviderError('WhatsApp de la plataforma no configurado', false);
    return new ConsoleSender('whatsapp:platform');
  }

  email(): Sender {
    if (this.env.RESEND_API_KEY)
      return new ResendSender(this.env.RESEND_API_KEY, this.env.EMAIL_FROM, this.fetchFn);
    if (this.env.NODE_ENV === 'production')
      throw new ProviderError('Email no configurado (RESEND_API_KEY)', false);
    return new ConsoleSender('email');
  }

  creds<T>(config: WhatsAppConfigRow | null): T {
    if (!config?.credentialsEnc)
      throw new ProviderError('Faltan las credenciales del proveedor de WhatsApp', false);
    return this.crypto.decryptJson<T>(config.credentialsEnc, config.keyVersion);
  }
}
