import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { ProvisioningService } from '../barbershops/provisioning.service';
import { RESERVED_SLUGS, SlugSchema, slugify } from '../barbershops/slug';

/** Máximo de barberías que un usuario puede crear por su cuenta (anti-abuso). */
export const MAX_SELF_SERVICE_SHOPS = 3;

export type SlugAvailability = {
  slug: string;
  available: boolean;
  reason?: 'invalid' | 'reserved' | 'taken';
  suggestion?: string;
};

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: ProvisioningService,
  ) {}

  /** Alta self-service con el plan por defecto de la plataforma y su prueba gratuita. */
  create(userId: string, input: { name: string; slug?: string }) {
    return this.prisma.run({ kind: 'system' }, async (tx) => {
      const owned = await tx.membership.count({
        where: { userId, role: 'owner', deletedAt: null, barbershop: { deletedAt: null } },
      });
      if (owned >= MAX_SELF_SERVICE_SHOPS)
        throw AppError.conflict(`Puedes crear hasta ${MAX_SELF_SERVICE_SHOPS} barberías`);

      const slug = input.slug ?? (await this.freeSlug(tx, slugify(input.name)));
      const plan = await defaultPlan(tx);
      const r = await this.provisioning.provision(tx, {
        name: input.name,
        slug,
        planId: plan.id,
        trialDays: plan.trialDays,
        ownerUserId: userId,
      });
      return { id: r.barbershopId, slug: r.slug };
    });
  }

  availability(raw: string): Promise<SlugAvailability> {
    return this.prisma.run({ kind: 'system' }, async (tx) => {
      const lowered = raw.trim().toLowerCase();
      const parsed = SlugSchema.safeParse(lowered);
      if (!parsed.success) {
        const reason = RESERVED_SLUGS.has(lowered) ? 'reserved' : 'invalid';
        return {
          slug: lowered,
          available: false,
          reason,
          suggestion: await this.freeSlug(tx, slugify(lowered) || 'mi-barberia'),
        };
      }
      if (await taken(tx, parsed.data)) {
        return {
          slug: parsed.data,
          available: false,
          reason: 'taken',
          suggestion: await this.freeSlug(tx, parsed.data),
        };
      }
      return { slug: parsed.data, available: true };
    });
  }

  /** "el-barbas" → "el-barbas" o, si está ocupado/reservado, "el-barbas-2", "-3"… */
  private async freeSlug(tx: Tx, base: string): Promise<string> {
    let root = base.slice(0, 44).replace(/-+$/, '');
    if (root.length < 3) root = `${root}-barberia`.replace(/^-/, '');
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? root : `${root}-${i}`;
      if (SlugSchema.safeParse(candidate).success && !(await taken(tx, candidate)))
        return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }
}

async function taken(tx: Tx, slug: string): Promise<boolean> {
  return (await tx.barbershop.count({ where: { slug, deletedAt: null } })) > 0;
}

async function defaultPlan(tx: Tx) {
  const settings = await tx.platformSettings.findUnique({
    where: { id: 1 },
    select: { data: true },
  });
  const code = (settings?.data as { defaultPlanCode?: unknown } | null)?.defaultPlanCode;
  const select = { id: true, trialDays: true } as const;
  const byCode =
    typeof code === 'string'
      ? await tx.plan.findFirst({ where: { code, deletedAt: null }, select })
      : null;
  const plan =
    byCode ??
    (await tx.plan.findFirst({
      where: { isPublic: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
      select,
    }));
  if (!plan) throw AppError.conflict('La plataforma aún no tiene planes configurados');
  return plan;
}
