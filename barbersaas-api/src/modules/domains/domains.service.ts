import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { PlanLimitsService } from '../../common/plan-limits/plan-limits.service';
import { tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { badRequest } from '../shop/shop-helpers';
import { DNS_RESOLVER, orEmpty, type DnsResolver } from './dns-resolver';
import { DomainRegistry } from './domain-registry';
import { TXT_PREFIX, evaluateDns, instructions, normalizeDomain } from './rules';

const select = {
  slug: true,
  customDomain: true,
  customDomainToken: true,
  customDomainVerifiedAt: true,
  customDomainCheckedAt: true,
  customDomainError: true,
} as const;
type Row = {
  slug: string;
  customDomain: string | null;
  customDomainToken: string | null;
  customDomainVerifiedAt: Date | null;
  customDomainCheckedAt: Date | null;
  customDomainError: string | null;
};

/** Dominio propio de la barbería: alta, verificación DNS y baja. */
@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
    private readonly registry: DomainRegistry,
    @Inject(DNS_RESOLVER) private readonly dns: DnsResolver,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async get(t: TenantContext) {
    const row = await this.row(t);
    return this.toDto(row, await this.featureEnabled(t));
  }

  async set(t: TenantContext, input: string) {
    await this.plans.assertFeature(t.barbershopId, 'customDomain');
    const n = normalizeDomain(input, this.env.ROOT_DOMAIN);
    if (!n.ok) throw badRequest('domain', n.error);
    const before = await this.row(t);
    if (before.customDomain === n.domain) return this.toDto(before, true);
    const row = await this.prisma.run(tenantDb(t), async (tx) => {
      const [taken] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM barbershops WHERE lower(custom_domain) = ${n.domain} AND id <> ${t.barbershopId}::uuid AND deleted_at IS NULL LIMIT 1`;
      if (taken) throw AppError.conflict('Ese dominio ya lo usa otra barbería');
      const r = await tx.barbershop.update({
        where: { id: t.barbershopId },
        data: {
          customDomain: n.domain,
          customDomainToken: randomBytes(12).toString('hex'),
          customDomainVerifiedAt: null,
          customDomainCheckedAt: null,
          customDomainError: null,
        },
        select,
      });
      await this.audit.record(tx, {
        action: 'shop.domain.set',
        barbershopId: t.barbershopId,
        entity: 'barbershop',
        entityId: t.barbershopId,
        diff: { domain: n.domain },
      });
      return r;
    });
    this.registry.forget(before.customDomain);
    return this.toDto(row, true);
  }

  /** Consulta el DNS ahora. Si está bien, queda verificado (y Caddy podrá emitir el certificado). */
  async verify(t: TenantContext) {
    const before = await this.row(t);
    if (!before.customDomain || !before.customDomainToken)
      throw AppError.conflict('Primero agrega un dominio');
    await this.plans.assertFeature(t.barbershopId, 'customDomain');
    const domain = before.customDomain;
    const target = this.target(before.slug);
    const [txt, cname, a, targetA] = await Promise.all([
      orEmpty(this.dns.resolveTxt(`${TXT_PREFIX}.${domain}`)),
      orEmpty(this.dns.resolveCname(domain)),
      orEmpty(this.dns.resolve4(domain)),
      orEmpty(this.dns.resolve4(target)),
    ]);
    const r = evaluateDns({ txt, cname, a, targetA }, before.customDomainToken, target);
    const now = new Date();
    const row = await this.prisma.run(tenantDb(t), async (tx) => {
      const u = await tx.barbershop.update({
        where: { id: t.barbershopId },
        data: {
          customDomainCheckedAt: now,
          customDomainError: r.error,
          customDomainVerifiedAt: r.ok ? (before.customDomainVerifiedAt ?? now) : null,
        },
        select,
      });
      if (r.ok && !before.customDomainVerifiedAt)
        await this.audit.record(tx, {
          action: 'shop.domain.verified',
          barbershopId: t.barbershopId,
          entity: 'barbershop',
          entityId: t.barbershopId,
          diff: { domain },
        });
      return u;
    });
    this.registry.forget(domain);
    return this.toDto(row, true);
  }

  async remove(t: TenantContext): Promise<void> {
    const before = await this.row(t);
    await this.prisma.run(tenantDb(t), async (tx) => {
      await tx.barbershop.update({
        where: { id: t.barbershopId },
        data: {
          customDomain: null,
          customDomainToken: null,
          customDomainVerifiedAt: null,
          customDomainCheckedAt: null,
          customDomainError: null,
        },
      });
      await this.audit.record(tx, {
        action: 'shop.domain.remove',
        barbershopId: t.barbershopId,
        entity: 'barbershop',
        entityId: t.barbershopId,
        diff: { domain: before.customDomain },
      });
    });
    this.registry.forget(before.customDomain);
  }

  /** Público: hostname → barbería (solo dominios verificados). */
  async resolve(host: string) {
    const slug = await this.registry.slugFor(host);
    if (!slug) throw AppError.notFound('Dominio');
    return { slug };
  }

  // ───────────────────────── internos ─────────────────────────

  private target(slug: string) {
    return `${slug}.${this.env.ROOT_DOMAIN}`;
  }

  private async row(t: TenantContext): Promise<Row> {
    return this.prisma.run(tenantDb(t), (tx) =>
      tx.barbershop.findUniqueOrThrow({ where: { id: t.barbershopId }, select }),
    );
  }

  private async featureEnabled(t: TenantContext) {
    return !!(await this.plans.entitlements(t.barbershopId)).features.customDomain;
  }

  private async toDto(r: Row, featureEnabled: boolean) {
    const target = this.target(r.slug);
    const targetA = r.customDomain ? await orEmpty(this.dns.resolve4(target)).catch(() => []) : [];
    return {
      domain: r.customDomain,
      status: !r.customDomain
        ? ('none' as const)
        : r.customDomainVerifiedAt
          ? ('verified' as const)
          : ('pending' as const),
      featureEnabled,
      verifiedAt: r.customDomainVerifiedAt,
      checkedAt: r.customDomainCheckedAt,
      error: r.customDomainError,
      instructions:
        r.customDomain && r.customDomainToken
          ? instructions(r.customDomain, r.customDomainToken, target, targetA)
          : null,
      defaultUrl: `https://${target}`,
    };
  }
}
