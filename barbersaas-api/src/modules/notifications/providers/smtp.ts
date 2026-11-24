import { createTransport, type Transporter } from 'nodemailer';
import { ProviderError, type OutgoingMessage, type SendResult, type Sender } from './types';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Códigos de nodemailer que no conviene reintentar (credenciales o mensaje mal formado). */
const PERMANENT = new Set(['EAUTH', 'EENVELOPE', 'EMESSAGE']);

/**
 * Correo por SMTP (p. ej. Gmail con "contraseña de aplicación": smtp.gmail.com:465). El remitente
 * debe ser la misma cuenta (Gmail reemplaza el From si no coincide).
 */
export class SmtpSender implements Sender {
  readonly name = 'smtp';
  private readonly transport: Pick<Transporter, 'sendMail'>;

  constructor(
    private readonly cfg: SmtpConfig,
    transport?: Pick<Transporter, 'sendMail'>,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    try {
      const r = (await this.transport.sendMail({
        from: this.cfg.from,
        to: msg.to,
        subject: msg.subject ?? '',
        text: msg.body,
      })) as { messageId?: string };
      return { status: 'sent', providerMessageId: r.messageId ?? null };
    } catch (e) {
      const err = e as { code?: string; responseCode?: number; message?: string };
      const permanent =
        PERMANENT.has(err.code ?? '') ||
        (err.responseCode !== undefined && err.responseCode >= 500);
      throw new ProviderError(
        `SMTP: ${err.message ?? 'error al enviar'}`,
        !permanent,
        err.code ?? (err.responseCode ? String(err.responseCode) : undefined),
      );
    }
  }
}
