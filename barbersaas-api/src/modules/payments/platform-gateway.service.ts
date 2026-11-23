import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { platformDb } from '../../common/auth/platform-db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { GatewayAccountsService, parseCreds, verifyOrThrow } from './accounts.service';
import { hashToken, newWebhookToken, type SealedAccount } from './gateway-crypto';
import type { ConnectGatewayDto, UpdateGatewayDto } from './payments.dto';
import { GatewayRegistry } from './providers/registry';
import { GatewayHttpError } from './providers/types';

const select = {
  id: true,
  provider: true,
  mode: true,
  isActive: true,
  status: true,
  lastError: true,
  verifiedAt: true,
  publicInfo: true,
  credentialsEnc: true,
  keyVersion: true,
  createdAt: true,
} as const satisfies Prisma.PlatformGatewaySelect;
type Row = Prisma.PlatformGatewayGetPayload<{ select: typeof select }>;

/**
 * Pasarela de la plataforma (cobra la suscripción a las barberías). Solo superadmin.
 * Mismo esquema que la de cada barbería: credenciales cifradas, una sola activa, webhook con token.
 */
@Injectable()
export class PlatformGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly registry: GatewayRegistry,
    private readonly accounts: GatewayAccountsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async overview(u: AuthUser) {
    const rows = await this.prisma.run(platformDb(u), (tx) =>
      tx.platformGateway.findMany({
        where: { deletedAt: null },
        select,
        orderBy: { createdAt: 'asc' },
      }),
    );
    return {
      enabled: true,
      accounts: rows.map((r) => this.view(r)),
      providers: this.registry
        .list()
        .map((g) => ({ id: g.id, name: g.name, devOnly: g.devOnly, fields: g.fields })),
    };
  }

  async connect(u: AuthUser, dto: ConnectGatewayDto) {
    const g = this.accounts.gateway(dto.provider);
    const creds = parseCreds(g, dto.credentials);
    const account = await verifyOrThrow(g, creds);
    const token = newWebhookToken();
    const sealed = this.crypto.encryptJson({ creds, webhookToken: token } satisfies SealedAccount);
    return this.prisma.run(platformDb(u), async (tx) => {
      if (await tx.platformGateway.count({ where: { provider: dto.provider, deletedAt: null } }))
        throw AppError.conflict(`${g.name} ya está conectado`);
      const hasActive = await tx.platformGateway.count({
        where: { deletedAt: null, isActive: true },
      });
      const row = await tx.platformGateway.create({
        data: {
          provider: dto.provider,
          mode: g.modeOf(creds),
          credentialsEnc: Buffer.from(sealed.data),
          keyVersion: sealed.keyVersion,
          publicInfo: { ...g.publicInfo(creds), ...(account ? { account } : {}) },
          webhookTokenHash: hashToken(token),
          isActive: hasActive === 0,
          status: 'ok',
          verifiedAt: new Date(),
        },
        select,
      });
      await this.audit.record(tx, {
        action: 'platform.gateway.connect',
        entity: 'platform_gateway',
        entityId: row.id,
        diff: { provider: dto.provider, mode: row.mode },
      });
      return this.view(row);
    });
  }

  async update(u: AuthUser, id: string, dto: UpdateGatewayDto) {
    const current = await this.find(u, id);
    const g = this.accounts.gateway(current.provider);
    let data: Prisma.PlatformGatewayUpdateInput = {};
    if (dto.credentials) {
      const creds = parseCreds(g, dto.credentials);
      const account = await verifyOrThrow(g, creds);
      const sealed = this.crypto.encryptJson({
        creds,
        webhookToken: this.unseal(current).webhookToken,
      });
      data = {
        credentialsEnc: Buffer.from(sealed.data),
        keyVersion: sealed.keyVersion,
        mode: g.modeOf(creds),
        publicInfo: { ...g.publicInfo(creds), ...(account ? { account } : {}) },
        status: 'ok',
        lastError: null,
        verifiedAt: new Date(),
      };
    }
    return this.prisma.run(platformDb(u), async (tx) => {
      if (dto.isActive === true)
        await tx.platformGateway.updateMany({
          where: { deletedAt: null, isActive: true, id: { not: id } },
          data: { isActive: false },
        });
      const row = await tx.platformGateway.update({
        where: { id },
        data: { ...data, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
        select,
      });
      await this.audit.record(tx, {
        action: 'platform.gateway.update',
        entity: 'platform_gateway',
        entityId: id,
        diff: { credentials: !!dto.credentials, isActive: dto.isActive },
      });
      return this.view(row);
    });
  }

  async verify(u: AuthUser, id: string) {
    const current = await this.find(u, id);
    let status: 'ok' | 'error' = 'ok';
    let lastError: string | null = null;
    try {
      await this.accounts.gateway(current.provider).verify(this.unseal(current).creds);
    } catch (e) {
      status = 'error';
      lastError = e instanceof GatewayHttpError ? e.message : 'No se pudo conectar con la pasarela';
    }
    return this.prisma.run(platformDb(u), async (tx) =>
      this.view(
        await tx.platformGateway.update({
          where: { id },
          data: { status, lastError, ...(status === 'ok' ? { verifiedAt: new Date() } : {}) },
          select,
        }),
      ),
    );
  }

  async remove(u: AuthUser, id: string) {
    await this.find(u, id);
    await this.prisma.run(platformDb(u), async (tx) => {
      await tx.invoiceCharge.updateMany({
        where: { gatewayId: id, status: 'pending' },
        data: { status: 'canceled' },
      });
      await tx.platformGateway.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.record(tx, {
        action: 'platform.gateway.disconnect',
        entity: 'platform_gateway',
        entityId: id,
      });
    });
  }

  unseal(row: { credentialsEnc: Uint8Array; keyVersion: number }): SealedAccount {
    return this.crypto.decryptJson<SealedAccount>(row.credentialsEnc, row.keyVersion);
  }

  webhookUrl(token: string): string {
    return `${this.env.PUBLIC_API_URL}/v1/webhooks/platform-payments/${token}`;
  }

  private async find(u: AuthUser, id: string) {
    const row = await this.prisma.run(platformDb(u), (tx) =>
      tx.platformGateway.findFirst({ where: { id, deletedAt: null }, select }),
    );
    if (!row) throw AppError.notFound('Pasarela');
    return row;
  }

  private view(r: Row) {
    return {
      id: r.id,
      provider: r.provider,
      providerName: this.registry.get(r.provider)?.name ?? r.provider,
      mode: r.mode as 'test' | 'live',
      isActive: r.isActive,
      status: r.status,
      lastError: r.lastError,
      verifiedAt: r.verifiedAt,
      publicInfo: (r.publicInfo ?? {}) as Record<string, string>,
      webhookUrl: this.webhookUrl(this.unseal(r).webhookToken),
      createdAt: r.createdAt,
    };
  }
}
