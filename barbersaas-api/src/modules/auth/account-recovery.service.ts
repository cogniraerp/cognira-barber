import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { TokenService } from '../../common/auth/token.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { RequestContext } from '../../common/request-context/request-context';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { AuthTokenKind } from '../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { SenderRegistry } from '../notifications/sender-registry';
import { badRequest } from '../shop/shop-helpers';
import {
  RESEND_COOLDOWN_MS,
  RESET_TTL_MS,
  VERIFY_TTL_MS,
  passwordChangedEmail,
  resetEmail,
  tokenMessage,
  tokenState,
  verifyEmail,
} from './account-emails';
import { hashPassword } from './password';

const SYSTEM = { kind: 'system' } as const;

/**
 * Recuperar contraseña y verificar correo (auth local). Los links llevan un token aleatorio de un
 * solo uso; en la base solo queda su hash. Todo en contexto 'system' (no hay sesión todavía).
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger('AccountRecovery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly senders: SenderRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Siempre responde igual (exista o no la cuenta) para no revelar qué correos están registrados.
   * El correo se envía en segundo plano: el tiempo de respuesta tampoco delata nada.
   */
  async forgotPassword(email: string): Promise<void> {
    const issued = await this.prisma.run(SYSTEM, async (tx) => {
      const user = await tx.user.findFirst({
        where: { email, deletedAt: null, passwordHash: { not: null } },
        select: { id: true, email: true, fullName: true },
      });
      if (!user) return null;
      const token = await this.issueToken(tx, user.id, 'password_reset', RESET_TTL_MS);
      if (!token) return null;
      RequestContext.patch({ userId: user.id });
      await this.audit.record(tx, {
        action: 'auth.password_reset_requested',
        entity: 'user',
        entityId: user.id,
      });
      return { user, token };
    });
    if (!issued) return;
    const url = `${this.env.WEB_URL}/restablecer?token=${issued.token}`;
    this.mail(issued.user.email, resetEmail({ name: issued.user.fullName, url }));
  }

  /** Cambia la contraseña, cierra todas las sesiones y da el correo por verificado. */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.run(SYSTEM, async (tx) => {
      const row = await this.claim(tx, token, 'password_reset');
      const now = new Date();
      const u = await tx.user.findUniqueOrThrow({
        where: { id: row.userId },
        select: { id: true, email: true, fullName: true, emailVerifiedAt: true },
      });
      await tx.user.update({
        where: { id: u.id },
        data: { passwordHash, emailVerifiedAt: u.emailVerifiedAt ?? now },
      });
      // Otros links de recuperación pendientes dejan de servir.
      await tx.authToken.updateMany({
        where: { userId: u.id, kind: 'password_reset', usedAt: null },
        data: { usedAt: now },
      });
      await tx.authSession.updateMany({
        where: { userId: u.id, revokedAt: null },
        data: { revokedAt: now },
      });
      RequestContext.patch({ userId: u.id });
      await this.audit.record(tx, {
        action: 'auth.password_reset',
        entity: 'user',
        entityId: u.id,
      });
      return u;
    });
    this.mail(user.email, passwordChangedEmail({ name: user.fullName }));
  }

  /** Confirma el correo. Abrir el mismo link dos veces no es un error si ya quedó verificado. */
  async verifyEmail(token: string): Promise<void> {
    const hash = TokenService.hashRefresh(token);
    await this.prisma.run(SYSTEM, async (tx) => {
      const now = new Date();
      const claimed = await tx.authToken.updateMany({
        where: { tokenHash: hash, kind: 'email_verify', usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      const row = await tx.authToken.findFirst({
        where: { tokenHash: hash, kind: 'email_verify' },
        select: {
          userId: true,
          usedAt: true,
          expiresAt: true,
          user: { select: { emailVerifiedAt: true } },
        },
      });
      if (claimed.count === 0) {
        if (row?.user.emailVerifiedAt) return;
        const st = tokenState(row, now);
        throw badRequest('token', tokenMessage(st === 'ok' ? 'invalid' : st));
      }
      await tx.user.update({ where: { id: row!.userId }, data: { emailVerifiedAt: now } });
      RequestContext.patch({ userId: row!.userId });
      await this.audit.record(tx, {
        action: 'auth.email_verified',
        entity: 'user',
        entityId: row!.userId,
      });
    });
  }

  /**
   * Envía (o reenvía) el link de verificación. `strict`: el usuario lo pidió (avisa si ya está
   * verificado o si debe esperar); sin `strict` (al registrarse) no lanza nunca.
   */
  async sendVerification(userId: string, strict = false): Promise<void> {
    const issued = await this.prisma.run(SYSTEM, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, fullName: true, emailVerifiedAt: true },
      });
      if (user.emailVerifiedAt) {
        if (strict) throw AppError.conflict('Tu correo ya está verificado');
        return null;
      }
      const token = await this.issueToken(tx, userId, 'email_verify', VERIFY_TTL_MS);
      if (!token) {
        if (strict)
          throw new AppError(
            ErrorCode.RATE_LIMITED,
            HttpStatus.TOO_MANY_REQUESTS,
            'Ya te enviamos un enlace hace un momento. Revisa tu bandeja (y la carpeta de spam).',
          );
        return null;
      }
      return { user, token };
    });
    if (!issued) return;
    const url = `${this.env.WEB_URL}/verificar-correo?token=${issued.token}`;
    this.mail(issued.user.email, verifyEmail({ name: issued.user.fullName, url }));
  }

  // ───────────────────────── internos ─────────────────────────

  /** Crea un token nuevo, salvo que se haya enviado otro hace menos de un minuto (null). */
  private async issueToken(
    tx: Tx,
    userId: string,
    kind: AuthTokenKind,
    ttlMs: number,
  ): Promise<string | null> {
    const recent = await tx.authToken.findFirst({
      where: { userId, kind, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return null;
    const token = randomBytes(32).toString('base64url');
    await tx.authToken.create({
      data: {
        userId,
        kind,
        tokenHash: TokenService.hashRefresh(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return token;
  }

  /** Marca el token como usado de forma atómica: de dos usos simultáneos, solo uno gana. */
  private async claim(tx: Tx, token: string, kind: AuthTokenKind): Promise<{ userId: string }> {
    const hash = TokenService.hashRefresh(token);
    const now = new Date();
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash: hash, kind, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    const row = await tx.authToken.findFirst({
      where: { tokenHash: hash, kind },
      select: { userId: true, usedAt: true, expiresAt: true },
    });
    if (claimed.count === 0 || !row) {
      const st = claimed.count === 0 && row ? tokenState(row, now) : 'invalid';
      throw badRequest('token', tokenMessage(st === 'ok' ? 'used' : st));
    }
    return { userId: row.userId };
  }

  private mail(to: string, msg: { subject: string; body: string }): void {
    let sender;
    try {
      sender = this.senders.email();
    } catch (e) {
      this.logger.error(`No se pudo enviar "${msg.subject}": ${(e as Error).message}`);
      return;
    }
    sender
      .send({ to, subject: msg.subject, body: msg.body })
      .catch((e: Error) => this.logger.error(`No se pudo enviar "${msg.subject}": ${e.message}`));
  }
}
