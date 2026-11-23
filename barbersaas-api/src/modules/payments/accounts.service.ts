import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { GatewayProvider } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { hashToken, newWebhookToken, type SealedAccount } from './gateway-crypto';
import type { ConnectGatewayDto, UpdateGatewayDto } from './payments.dto';
import { GatewayRegistry } from './providers/registry';
import { GatewayHttpError, type ShopGateway } from './providers/types';

export const accountSelect = {
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
} as const satisfies Prisma.PaymentGatewayAccountSelect;
type AccountRow = Prisma.PaymentGatewayAccountGetPayload<{ select: typeof accountSelect }>;

/**
 * Pasarela propia de cada barbería: conectar (con prueba de credenciales), activar la que usa la
 * caja, reprobar y desconectar. Las credenciales se guardan cifradas y nunca se devuelven.
 */
@Injectable()
export class GatewayAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly plans: PlanLimitsService,
    private readonly registry: GatewayRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async overview(t: TenantContext) {
    const { features } = await this.plans.entitlements(t.barbershopId);
    const rows = await this.prisma.run(tenantDb(t), (tx) =>
      tx.paymentGatewayAccount.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: accountSelect,
        orderBy: { createdAt: 'asc' },
      }),
    );
    return {
      enabled: features.onlinePayments,
      accounts: rows.map((r) => this.view(r)),
      providers: this.registry.list().map((g) => ({
        id: g.id,
        name: g.name,
        devOnly: g.devOnly,
        fields: g.fields,
      })),
    };
  }

  async connect(t: TenantContext, dto: ConnectGatewayDto) {
    await this.plans.assertFeature(t.barbershopId, 'onlinePayments');
    const g = this.gateway(dto.provider);
    const creds = parseCreds(g, dto.credentials);
    const account = await verifyOrThrow(g, creds);
    const token = newWebhookToken();
    const sealed = this.crypto.encryptJson({ creds, webhookToken: token } satisfies SealedAccount);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const dup = await tx.paymentGatewayAccount.findFirst({
        where: { barbershopId: t.barbershopId, provider: dto.provider, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw AppError.conflict(`${g.name} ya está conectado`);
      const hasActive = await tx.paymentGatewayAccount.count({
        where: { barbershopId: t.barbershopId, deletedAt: null, isActive: true },
      });
      const row = await tx.paymentGatewayAccount.create({
        data: {
          barbershopId: t.barbershopId,
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
        select: accountSelect,
      });
      await this.audit.record(tx, {
        action: 'shop.gateway.connect',
        barbershopId: t.barbershopId,
        entity: 'payment_gateway_account',
        entityId: row.id,
        diff: { provider: dto.provider, mode: row.mode },
      });
      return this.view(row);
    });
  }

  async update(t: TenantContext, id: string, dto: UpdateGatewayDto) {
    const current = await this.prisma.run(tenantDb(t), (tx) => findAccount(tx, t, id));
    const g = this.gateway(current.provider);
    let data: Prisma.PaymentGatewayAccountUpdateInput = {};
    if (dto.credentials) {
      const creds = parseCreds(g, dto.credentials);
      const account = await verifyOrThrow(g, creds);
      const old = this.unseal(current);
      const sealed = this.crypto.encryptJson({ creds, webhookToken: old.webhookToken });
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
    return this.prisma.run(tenantDb(t), async (tx) => {
      if (dto.isActive === true) {
        await tx.paymentGatewayAccount.updateMany({
          where: { barbershopId: t.barbershopId, deletedAt: null, isActive: true, id: { not: id } },
          data: { isActive: false },
        });
      }
      const row = await tx.paymentGatewayAccount.update({
        where: { id },
        data: { ...data, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
        select: accountSelect,
      });
      await this.audit.record(tx, {
        action: 'shop.gateway.update',
        barbershopId: t.barbershopId,
        entity: 'payment_gateway_account',
        entityId: id,
        diff: { credentials: !!dto.credentials, isActive: dto.isActive },
      });
      return this.view(row);
    });
  }

  /** Vuelve a probar las credenciales guardadas. */
  async verify(t: TenantContext, id: string) {
    const current = await this.prisma.run(tenantDb(t), (tx) => findAccount(tx, t, id));
    const g = this.gateway(current.provider);
    let status: 'ok' | 'error' = 'ok';
    let lastError: string | null = null;
    try {
      await g.verify(this.unseal(current).creds);
    } catch (e) {
      status = 'error';
      lastError = e instanceof GatewayHttpError ? e.message : 'No se pudo conectar con la pasarela';
    }
    return this.prisma.run(tenantDb(t), async (tx) =>
      this.view(
        await tx.paymentGatewayAccount.update({
          where: { id },
          data: { status, lastError, ...(status === 'ok' ? { verifiedAt: new Date() } : {}) },
          select: accountSelect,
        }),
      ),
    );
  }

  /** Desconecta: los cobros pendientes se cancelan; el historial queda. */
  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findAccount(tx, t, id);
      await tx.paymentCharge.updateMany({
        where: { accountId: id, status: 'pending' },
        data: { status: 'canceled' },
      });
      await tx.paymentGatewayAccount.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await this.audit.record(tx, {
        action: 'shop.gateway.disconnect',
        barbershopId: t.barbershopId,
        entity: 'payment_gateway_account',
        entityId: id,
      });
    });
  }

  unseal(row: { credentialsEnc: Uint8Array; keyVersion: number }): SealedAccount {
    return this.crypto.decryptJson<SealedAccount>(row.credentialsEnc, row.keyVersion);
  }

  webhookUrl(token: string): string {
    return `${this.env.PUBLIC_API_URL}/v1/webhooks/payments/${token}`;
  }

  gateway(id: GatewayProvider): ShopGateway {
    const g = this.registry.get(id);
    if (!g)
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Pasarela no disponible',
      );
    return g;
  }

  private view(r: AccountRow) {
    const g = this.registry.get(r.provider);
    return {
      id: r.id,
      provider: r.provider,
      providerName: g?.name ?? r.provider,
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

async function findAccount(tx: Tx, t: TenantContext, id: string) {
  const row = await tx.paymentGatewayAccount.findFirst({
    where: { id, barbershopId: t.barbershopId, deletedAt: null },
    select: accountSelect,
  });
  if (!row) throw AppError.notFound('Pasarela');
  return row;
}

export function parseCreds(g: ShopGateway, raw: Record<string, string>): Record<string, unknown> {
  const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v.trim() !== ''));
  const r = g.credentials.safeParse(clean);
  if (!r.success)
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      HttpStatus.BAD_REQUEST,
      'Credenciales inválidas',
      {
        errors: r.error.issues.map((i) => ({
          path: `credentials.${i.path.join('.')}`,
          message: i.message,
        })),
      },
    );
  return r.data as Record<string, unknown>;
}

export async function verifyOrThrow(g: ShopGateway, creds: unknown): Promise<string | null> {
  try {
    return (await g.verify(creds)).account;
  } catch (e) {
    throw new AppError(
      ErrorCode.GATEWAY_ERROR,
      HttpStatus.BAD_GATEWAY,
      e instanceof GatewayHttpError ? e.message : 'No se pudo conectar con la pasarela',
    );
  }
}
