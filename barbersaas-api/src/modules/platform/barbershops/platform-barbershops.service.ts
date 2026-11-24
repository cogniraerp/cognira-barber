import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import type { AuthUser } from '../../../common/auth/auth.types';
import { platformDb } from '../../../common/auth/platform-db';
import { TokenService } from '../../../common/auth/token.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { pageArgs } from '../../../common/http/zod';
import { PlanLimitsOverrideSchema } from '../../../common/plan-limits/plan.schemas';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import { ProvisioningService } from '../../barbershops/provisioning.service';
import { newInviteToken } from '../../invitations/invite-token';
import type {
  ChangePlanDto,
  CreateBarbershopDto,
  ExtendTrialDto,
  ListBarbershopsQueryDto,
  UpdateBarbershopDto,
} from './platform-barbershops.dto';

const IMPERSONATION_TTL_SECONDS = 30 * 60;

const listSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  country: true,
  createdAt: true,
  subscription: {
    select: {
      status: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      plan: { select: { id: true, code: true, name: true } },
    },
  },
} as const satisfies Prisma.BarbershopSelect;

/**
 * Gestión de barberías desde el panel de plataforma.
 *
 * Contextos de BD:
 *  - Lo que toca facturación (suscripción, plan) se lee con el contexto del usuario
 *    (superadmin/support), así la RLS se lo oculta a soporte.
 *  - Datos operativos no sensibles (owner, miembros, contadores de uso) se leen en
 *    contexto 'system', porque soporte no tiene acceso a las tablas del tenant sin impersonar.
 */
@Injectable()
export class PlatformBarbershopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provisioning: ProvisioningService,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Nuevo enlace de invitación para un miembro invitado (también el dueño, que desde el panel de la
   * barbería no se puede gestionar). Anula el enlace anterior y vence en 7 días.
   */
  async inviteLink(user: AuthUser, barbershopId: string, memberId: string) {
    return this.prisma.run(platformDb(user), async (tx) => {
      const m = await tx.membership.findFirst({
        where: { id: memberId, barbershopId, deletedAt: null },
        select: { status: true, inviteEmail: true },
      });
      if (!m) throw AppError.notFound('Miembro');
      if (m.status !== 'invited' || !m.inviteEmail)
        throw AppError.conflict(
          'Este usuario ya aceptó la invitación: usa el enlace de contraseña',
        );
      const invite = newInviteToken();
      await tx.membership.update({
        where: { id: memberId },
        data: { inviteToken: invite.hash, inviteExpiresAt: invite.expiresAt },
      });
      await this.audit.record(tx, {
        action: 'platform.member.invite_link',
        barbershopId,
        entity: 'membership',
        entityId: memberId,
      });
      return {
        url: `${this.env.WEB_URL.replace(/\/$/, '')}/invitacion/${invite.token}`,
        expiresAt: invite.expiresAt,
        email: m.inviteEmail,
      };
    });
  }

  async list(user: AuthUser, q: ListBarbershopsQueryDto) {
    const where: Prisma.BarbershopWhereInput = {
      ...(q.status ? { status: q.status } : { deletedAt: null }),
      ...(q.country ? { country: q.country } : {}),
      ...(q.planCode ? { subscription: { plan: { code: q.planCode } } } : {}),
      ...(q.createdFrom || q.createdTo
        ? {
            createdAt: {
              ...(q.createdFrom ? { gte: new Date(`${q.createdFrom}T00:00:00Z`) } : {}),
              ...(q.createdTo
                ? { lt: new Date(new Date(`${q.createdTo}T00:00:00Z`).getTime() + 86_400_000) }
                : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { slug: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const desc = q.sort.startsWith('-');
    const field = q.sort.replace('-', '') as 'createdAt' | 'name';

    const [items, total] = await this.prisma.run(platformDb(user), (tx) =>
      Promise.all([
        tx.barbershop.findMany({
          where,
          select: listSelect,
          orderBy: [{ [field]: desc ? 'desc' : 'asc' }, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.barbershop.count({ where }),
      ]),
    );
    const owners = await this.ownerEmails(items.map((i) => i.id));
    return {
      items: items.map((i) => ({ ...i, ownerEmail: owners.get(i.id) ?? null })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(user: AuthUser, id: string) {
    const shop = await this.prisma.run(platformDb(user), (tx) =>
      tx.barbershop.findUnique({
        where: { id },
        select: {
          ...listSelect,
          legalName: true,
          taxId: true,
          phone: true,
          email: true,
          timezone: true,
          currency: true,
          suspendedAt: true,
          deletedAt: true,
          subscription: {
            select: {
              id: true,
              status: true,
              interval: true,
              trialEndsAt: true,
              currentPeriodEnd: true,
              discountPercent: true,
              limitsOverride: true,
              plan: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
    );
    if (!shop) throw AppError.notFound('Barbería');

    const monthStart = startOfUtcMonth(new Date());
    const period = monthStart.toISOString().slice(0, 7);
    const { usage, members } = await this.prisma.run(
      { kind: 'system', barbershopId: id },
      async (tx) => {
        const base = { barbershopId: id, deletedAt: null };
        const [staff, locations, services, customers, appointmentsThisMonth, wa, members] =
          await Promise.all([
            tx.staff.count({ where: { ...base, isActive: true } }),
            tx.location.count({ where: base }),
            tx.service.count({ where: base }),
            tx.customer.count({ where: base }),
            tx.appointment.count({ where: { ...base, createdAt: { gte: monthStart } } }),
            tx.usageCounter.findUnique({
              where: {
                barbershopId_period_metric: {
                  barbershopId: id,
                  period,
                  metric: 'whatsappPerMonth',
                },
              },
              select: { count: true },
            }),
            tx.membership.findMany({
              where: base,
              select: {
                id: true,
                role: true,
                status: true,
                inviteEmail: true,
                user: { select: { id: true, email: true, fullName: true, emailVerifiedAt: true } },
              },
              orderBy: { createdAt: 'asc' },
            }),
          ]);
        return {
          usage: {
            staff,
            locations,
            services,
            customers,
            appointmentsThisMonth,
            whatsappThisMonth: wa?.count ?? 0,
          },
          members: members.map((m) => ({
            id: m.id,
            role: m.role,
            status: m.status,
            email: m.user?.email ?? m.inviteEmail,
            fullName: m.user?.fullName ?? null,
            userId: m.user?.id ?? null,
            emailVerified: !!m.user?.emailVerifiedAt,
          })),
        };
      },
    );

    const owner = members.find((m) => m.role === 'owner');
    const sub = shop.subscription;
    return {
      ...shop,
      ownerEmail: owner?.email ?? null,
      subscription: sub
        ? {
            ...sub,
            limitsOverride: sub.limitsOverride
              ? PlanLimitsOverrideSchema.catch({}).parse(sub.limitsOverride)
              : null,
          }
        : null,
      usage,
      members,
    };
  }

  /** Alta manual: si el email ya tiene cuenta, queda como owner activo; si no, se invita. */
  create(user: AuthUser, dto: CreateBarbershopDto) {
    return this.prisma.run(platformDb(user), async (tx) => {
      const plan = await findPlan(tx, dto.planCode);
      const existing = await tx.user.findFirst({
        where: { email: dto.ownerEmail, deletedAt: null },
        select: { id: true },
      });
      const r = await this.provisioning.provision(tx, {
        name: dto.name,
        slug: dto.slug,
        planId: plan.id,
        trialDays: dto.trialDays ?? plan.trialDays,
        ownerUserId: existing?.id,
        ownerEmail: existing ? undefined : dto.ownerEmail,
        country: dto.country,
        timezone: dto.timezone,
        currency: dto.currency,
      });
      return {
        id: r.barbershopId,
        slug: r.slug,
        ownerStatus: existing ? ('active' as const) : ('invited' as const),
        inviteToken: r.inviteToken ?? null,
      };
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateBarbershopDto) {
    await this.prisma.run(platformDb(user), async (tx) => {
      await findShop(tx, id);
      await tx.barbershop.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        action: 'platform.barbershop.update',
        barbershopId: id,
        entity: 'barbershop',
        entityId: id,
        diff: dto,
      });
    });
    return this.detail(user, id);
  }

  async suspend(user: AuthUser, id: string, reason: string) {
    await this.prisma.run(platformDb(user), async (tx) => {
      const shop = await findShop(tx, id);
      if (shop.status === 'suspended') throw AppError.conflict('La barbería ya está suspendida');
      await tx.barbershop.update({
        where: { id },
        data: { status: 'suspended', suspendedAt: new Date(), suspendedReason: 'manual' },
      });
      await this.audit.record(tx, {
        action: 'platform.barbershop.suspend',
        barbershopId: id,
        entity: 'barbershop',
        entityId: id,
        diff: { reason, from: shop.status },
      });
    });
    return this.detail(user, id);
  }

  async reactivate(user: AuthUser, id: string) {
    await this.prisma.run(platformDb(user), async (tx) => {
      const shop = await findShop(tx, id);
      if (shop.status !== 'suspended') throw AppError.conflict('La barbería no está suspendida');
      await tx.barbershop.update({
        where: { id },
        data: { status: 'active', suspendedAt: null, suspendedReason: null },
      });
      await this.audit.record(tx, {
        action: 'platform.barbershop.reactivate',
        barbershopId: id,
        entity: 'barbershop',
        entityId: id,
      });
    });
    return this.detail(user, id);
  }

  /** Soft delete: libera el slug, cancela la suscripción y bloquea todo acceso. */
  remove(user: AuthUser, id: string, reason: string) {
    return this.prisma.run(platformDb(user), async (tx) => {
      await findShop(tx, id);
      const now = new Date();
      await tx.barbershop.update({ where: { id }, data: { status: 'deleted', deletedAt: now } });
      await tx.subscription.updateMany({
        where: { barbershopId: id, canceledAt: null },
        data: { status: 'canceled', canceledAt: now },
      });
      await this.audit.record(tx, {
        action: 'platform.barbershop.delete',
        barbershopId: id,
        entity: 'barbershop',
        entityId: id,
        diff: { reason },
      });
    });
  }

  async extendTrial(user: AuthUser, id: string, dto: ExtendTrialDto) {
    await this.prisma.run(platformDb(user), async (tx) => {
      await findShop(tx, id);
      const sub = await tx.subscription.findUnique({
        where: { barbershopId: id },
        select: { id: true, status: true, trialEndsAt: true },
      });
      if (!sub || sub.status !== 'trialing')
        throw AppError.conflict('La barbería no está en periodo de prueba');
      const from = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
      const trialEndsAt = new Date(from.getTime() + dto.days * 86_400_000);
      await tx.subscription.update({
        where: { id: sub.id },
        data: { trialEndsAt, currentPeriodEnd: trialEndsAt },
      });
      await this.audit.record(tx, {
        action: 'platform.subscription.extend_trial',
        barbershopId: id,
        entity: 'subscription',
        entityId: sub.id,
        diff: {
          days: dto.days,
          from: sub.trialEndsAt?.toISOString() ?? null,
          to: trialEndsAt.toISOString(),
        },
      });
    });
    return this.detail(user, id);
  }

  async changePlan(user: AuthUser, id: string, dto: ChangePlanDto) {
    await this.prisma.run(platformDb(user), async (tx) => {
      await findShop(tx, id);
      const plan = await findPlan(tx, dto.planCode);
      const sub = await tx.subscription.findUnique({
        where: { barbershopId: id },
        select: {
          id: true,
          plan: { select: { code: true } },
          interval: true,
          discountPercent: true,
        },
      });
      if (!sub) throw AppError.notFound('Suscripción');
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          planId: plan.id,
          interval: dto.interval,
          discountPercent: dto.discountPercent,
          // Prisma exige el sentinel DbNull para escribir NULL en una columna Json.
          limitsOverride: dto.limitsOverride === null ? Prisma.DbNull : dto.limitsOverride,
        },
      });
      await this.audit.record(tx, {
        action: 'platform.subscription.change_plan',
        barbershopId: id,
        entity: 'subscription',
        entityId: sub.id,
        diff: {
          from: sub.plan.code,
          to: plan.code,
          interval: dto.interval ?? sub.interval,
          discountPercent: dto.discountPercent ?? sub.discountPercent,
        },
      });
    });
    return this.detail(user, id);
  }

  /** Token de acceso corto para operar como owner. Queda auditado (inicio aquí; cada acción, con impersonatorUserId). */
  impersonate(user: AuthUser, id: string) {
    return this.prisma.run(platformDb(user), async (tx) => {
      const shop = await findShop(tx, id);
      await this.audit.record(tx, {
        action: 'platform.impersonate.start',
        barbershopId: id,
        entity: 'barbershop',
        entityId: id,
        diff: { as: user.platformRole },
      });
      const accessToken = await this.tokens.signAccess({
        userId: user.userId,
        email: user.email,
        impersonation: { barbershopId: id, by: user.platformRole! },
        ttlSeconds: IMPERSONATION_TTL_SECONDS,
      });
      return {
        accessToken,
        tokenType: 'Bearer' as const,
        expiresIn: IMPERSONATION_TTL_SECONDS,
        barbershop: { id, slug: shop.slug, name: shop.name },
      };
    });
  }

  private async ownerEmails(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const owners = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.membership.findMany({
        where: { barbershopId: { in: ids }, role: 'owner', deletedAt: null },
        select: { barbershopId: true, inviteEmail: true, user: { select: { email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const map = new Map<string, string>();
    for (const o of owners) {
      const email = o.user?.email ?? o.inviteEmail;
      if (email && !map.has(o.barbershopId)) map.set(o.barbershopId, email);
    }
    return map;
  }
}

async function findShop(tx: Tx, id: string) {
  const shop = await tx.barbershop.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, slug: true, name: true, status: true },
  });
  if (!shop) throw AppError.notFound('Barbería');
  return shop;
}

async function findPlan(tx: Tx, code: string) {
  const plan = await tx.plan.findFirst({
    where: { code, deletedAt: null },
    select: { id: true, code: true, trialDays: true },
  });
  if (!plan)
    throw new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, 'Plan inexistente', {
      field: 'planCode',
    });
  return plan;
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
