import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SenderRegistry } from '../notifications/sender-registry';
import { inviteEmail } from './invite-email';

/**
 * Envía el correo de invitación en segundo plano. Si el correo no está configurado o falla, no
 * bloquea nada: el enlace también se muestra en pantalla (vía manual).
 */
@Injectable()
export class InviteMailer {
  private readonly logger = new Logger('InviteMailer');

  constructor(private readonly senders: SenderRegistry) {}

  send(to: string, p: { shopName: string; role: string; url: string; expiresAt: Date }): void {
    const msg = inviteEmail(p);
    let sender;
    try {
      sender = this.senders.email();
    } catch (e) {
      this.logger.warn(`Invitación sin correo: ${(e as Error).message}`);
      return;
    }
    sender
      .send({ to, subject: msg.subject, body: msg.body })
      .catch((e: Error) => this.logger.error(`No se pudo enviar la invitación: ${e.message}`));
  }
}

@Global()
@Module({ imports: [NotificationsModule], providers: [InviteMailer], exports: [InviteMailer] })
export class InviteMailModule {}
