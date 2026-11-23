import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Límite por USUARIO si el request está autenticado, por IP si no.
 * Evita que muchas personas detrás de la misma IP (oficina, cabina, red móvil con CGNAT)
 * se bloqueen entre sí, y que un usuario esquive el límite cambiando de IP.
 * Debe registrarse DESPUÉS del AuthGuard para ver `req.auth`.
 */
@Injectable()
export class UserOrIpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request;
    return Promise.resolve(r.auth ? `user:${r.auth.userId}` : `ip:${r.ip ?? 'unknown'}`);
  }
}
