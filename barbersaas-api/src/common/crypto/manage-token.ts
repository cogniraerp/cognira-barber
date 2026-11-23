import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Token de los enlaces "cancelar / reprogramar" que recibe el cliente.
 * Formato: `<appointmentId>.<HMAC-SHA256 truncado>`. No se guarda en BD: se puede regenerar
 * en cualquier momento (p. ej. en cada recordatorio de WhatsApp) y no se puede falsificar
 * sin la clave del servidor.
 */
@Injectable()
export class ManageTokenService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    // Clave derivada (no se reutiliza la clave de cifrado tal cual).
    this.key = createHmac('sha256', Buffer.from(env.ENCRYPTION_KEY, 'base64'))
      .update('appointment-manage-token/v1')
      .digest();
  }

  sign(appointmentId: string): string {
    return `${appointmentId}.${this.mac(appointmentId)}`;
  }

  /** Devuelve el id si el token es auténtico; null si no. */
  verify(token: string): string | null {
    const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token);
    if (!m) return null;
    const [, id, sig] = m as unknown as [string, string, string];
    const expected = Buffer.from(this.mac(id));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }

  private mac(id: string): string {
    return createHmac('sha256', this.key).update(id).digest('base64url').slice(0, 32);
  }
}
