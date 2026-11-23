import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { PlatformRole } from '../../generated/prisma/enums';
import { AppError } from '../errors/app-error';
import type { AccessTokenClaims } from './auth.types';

const AUDIENCE = 'barbersaas';

/**
 * Emite y verifica los JWT de acceso del proveedor de auth local (HS256).
 * Cuando se use Supabase, la verificación pasará a su JWKS detrás de esta misma interfaz.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  get accessTtlSeconds(): number {
    return this.env.JWT_ACCESS_TTL_SECONDS;
  }

  async signAccess(input: {
    userId: string;
    email: string;
    impersonation?: { barbershopId: string; by: PlatformRole };
    ttlSeconds?: number;
  }): Promise<string> {
    const claims: Omit<AccessTokenClaims, 'sub'> = { email: input.email, typ: 'access' };
    if (input.impersonation) {
      claims.imp = { sid: input.impersonation.barbershopId, by: input.impersonation.by };
    }
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${input.ttlSeconds ?? this.env.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.env.JWT_ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (
        payload.typ !== 'access' ||
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        throw AppError.unauthenticated();
      }
      return payload as unknown as AccessTokenClaims;
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof joseErrors.JWTExpired) throw AppError.unauthenticated('Token expirado');
      throw AppError.unauthenticated();
    }
  }

  /** Refresh token opaco: 256 bits aleatorios. En BD solo se guarda su SHA-256. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hashRefresh(token) };
  }

  static hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
