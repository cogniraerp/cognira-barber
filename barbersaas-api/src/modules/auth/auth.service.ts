import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import { TokenService } from '../../common/auth/token.service';
import { AppError } from '../../common/errors/app-error';
import { RequestContext } from '../../common/request-context/request-context';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import type { AuthTokens, LoginDto, RegisterDto } from './dto/auth.dto';
import { AccountRecoveryService } from './account-recovery.service';
import { dummyHash, hashPassword, verifyPassword } from './password';

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  platformRole: 'superadmin' | 'support' | null;
};

/**
 * Proveedor de auth LOCAL (email + contraseña).
 * Todo corre en contexto 'system': antes de autenticar no hay usuario con el que acotar la RLS.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly recovery: AccountRecoveryService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const passwordHash = await hashPassword(dto.password);
    let tokens: AuthTokens;
    try {
      tokens = await this.prisma.run({ kind: 'system' }, async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            fullName: dto.fullName,
            phone: dto.phone,
            passwordHash,
            termsAcceptedAt: new Date(),
          },
          select: userSelect,
        });
        RequestContext.patch({ userId: user.id });
        await this.audit.record(tx, { action: 'auth.register', entity: 'user', entityId: user.id });
        return this.issue(tx, user);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppError.conflict('Ya existe una cuenta con ese email');
      }
      throw e;
    }
    // Ya confirmado el alta: el link de verificación nunca hace fallar el registro.
    await this.recovery.sendVerification(tokens.user.id).catch(() => undefined);
    return tokens;
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const found = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.user.findFirst({
        where: { email: dto.email, deletedAt: null },
        select: { ...userSelect, passwordHash: true },
      }),
    );
    const ok = await verifyPassword(found?.passwordHash ?? (await dummyHash()), dto.password);
    if (!found || !found.passwordHash || !ok)
      throw AppError.unauthenticated('Email o contraseña incorrectos');

    const { passwordHash: _ignored, ...user } = found;
    return this.prisma.run({ kind: 'system' }, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      RequestContext.patch({ userId: user.id });
      await this.audit.record(tx, { action: 'auth.login', entity: 'user', entityId: user.id });
      return this.issue(tx, user);
    });
  }

  /**
   * Rotación de refresh tokens con detección de reutilización:
   * si llega un token ya revocado (posible robo), se revocan TODAS las sesiones del usuario.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = TokenService.hashRefresh(refreshToken);
    const result = await this.prisma.run({ kind: 'system' }, async (tx) => {
      const session = await tx.authSession.findUnique({
        where: { tokenHash: hash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          revokedAt: true,
          user: { select: { ...userSelect, deletedAt: true } },
        },
      });
      if (!session) return { error: 'invalid' as const };

      // Revocación condicional: de dos refresh concurrentes con el mismo token, solo uno gana.
      const claimed = await tx.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count === 0) {
        await tx.authSession.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        RequestContext.patch({ userId: session.userId });
        await this.audit.record(tx, {
          action: 'auth.refresh_reuse_detected',
          entity: 'user',
          entityId: session.userId,
        });
        return { error: 'reused' as const };
      }
      if (session.expiresAt <= new Date() || session.user.deletedAt)
        return { error: 'invalid' as const };

      const { deletedAt: _d, ...user } = session.user;
      return { tokens: await this.issue(tx, user) };
    });
    // El error se lanza fuera de la transacción para que la revocación masiva sí se confirme.
    if ('error' in result) throw AppError.unauthenticated();
    return result.tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = TokenService.hashRefresh(refreshToken);
    await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.authSession.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  private async issue(tx: Tx, user: UserRow): Promise<AuthTokens> {
    const rc = RequestContext.get();
    const refresh = this.tokens.newRefreshToken();
    await tx.authSession.create({
      data: {
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000),
        ip: rc?.ip,
        userAgent: rc?.userAgent,
      },
    });
    return {
      accessToken: await this.tokens.signAccess({ userId: user.id, email: user.email }),
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
      user,
    };
  }
}

const userSelect = { id: true, email: true, fullName: true, platformRole: true } as const;
