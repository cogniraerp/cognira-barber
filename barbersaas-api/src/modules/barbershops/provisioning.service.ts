import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../../infra/prisma/prisma.service';

export const INVITE_TTL_DAYS = 7;

export interface ProvisionInput {
  name: string;
  slug: string;
  planId: string;
  trialDays: number;
  /** Usuario existente que será owner (alta self-service o superadmin con email registrado). */
  ownerUserId?: string;
  /** Si el owner aún no tiene cuenta: se crea una invitación. */
  ownerEmail?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  locale?: string;
  now?: Date;
}

export interface ProvisionResult {
  barbershopId: string;
  slug: string;
  membershipId: string;
  subscriptionId: string;
  /** Token de invitación en claro: solo se devuelve una vez (en BD se guarda su hash). */
  inviteToken?: string;
}

/**
 * Alta de una barbería con todo lo mínimo para operar: settings, sede principal,
 * owner (o invitación) y suscripción en prueba. Debe llamarse dentro de una transacción
 * con contexto privilegiado ('system' o 'superadmin').
 */
@Injectable()
export class ProvisioningService {
  constructor(private readonly audit: AuditService) {}

  async provision(tx: Tx, input: ProvisionInput): Promise<ProvisionResult> {
    if (!input.ownerUserId && !input.ownerEmail) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Falta el owner de la barbería',
      );
    }
    const now = input.now ?? new Date();
    const timezone = input.timezone ?? 'America/Lima';

    let shop;
    try {
      shop = await tx.barbershop.create({
        data: {
          name: input.name,
          slug: input.slug,
          status: 'onboarding',
          country: input.country ?? 'PE',
          timezone,
          currency: input.currency ?? 'PEN',
          locale: input.locale ?? 'es-PE',
          onboarding: { currentStep: 'profile', completedSteps: [] },
        },
        select: { id: true, slug: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppError.conflict('Ese slug ya está en uso', ErrorCode.CONFLICT, { field: 'slug' });
      }
      throw e;
    }

    await tx.barbershopSettings.create({ data: { barbershopId: shop.id } });
    await tx.location.create({
      data: { barbershopId: shop.id, name: 'Sede principal', isPrimary: true, timezone },
    });

    let inviteToken: string | undefined;
    const membership = await tx.membership.create({
      data: input.ownerUserId
        ? { barbershopId: shop.id, userId: input.ownerUserId, role: 'owner', status: 'active' }
        : (() => {
            inviteToken = randomBytes(24).toString('base64url');
            return {
              barbershopId: shop.id,
              role: 'owner' as const,
              status: 'invited' as const,
              inviteEmail: input.ownerEmail!.toLowerCase(),
              inviteToken: createHash('sha256').update(inviteToken).digest('hex'),
              inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000),
            };
          })(),
      select: { id: true },
    });

    const trialEndsAt = new Date(now.getTime() + input.trialDays * 86_400_000);
    const subscription = await tx.subscription.create({
      data: {
        barbershopId: shop.id,
        planId: input.planId,
        status: input.trialDays > 0 ? 'trialing' : 'active',
        trialEndsAt: input.trialDays > 0 ? trialEndsAt : null,
        currentPeriodEnd: trialEndsAt,
      },
      select: { id: true },
    });

    await this.audit.record(tx, {
      action: 'barbershop.provision',
      barbershopId: shop.id,
      entity: 'barbershop',
      entityId: shop.id,
      diff: { name: input.name, slug: shop.slug, planId: input.planId, trialDays: input.trialDays },
    });

    return {
      barbershopId: shop.id,
      slug: shop.slug,
      membershipId: membership.id,
      subscriptionId: subscription.id,
      inviteToken,
    };
  }
}
