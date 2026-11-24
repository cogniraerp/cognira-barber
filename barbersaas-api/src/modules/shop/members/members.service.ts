import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { PlanLimitsService } from '../../../common/plan-limits/plan-limits.service';
import {
  PermissionOverridesSchema,
  ungrantable,
  type PermissionOverrides,
} from '../../../common/rbac/permissions';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import type { Prisma } from '../../../generated/prisma/client';
import type { MemberRole } from '../../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { InviteMailer } from '../../invitations/invite-mailer';
import { INVITE_TTL_MS, newInviteToken } from '../../invitations/invite-token';
import { find as findRole } from '../roles/roles.service';
import type { InviteMemberDto, UpdateMemberDto } from './members.dto';

const memberSelect = {
  id: true,
  role: true,
  status: true,
  permissions: true,
  inviteEmail: true,
  inviteExpiresAt: true,
  createdAt: true,
  user: { select: { email: true, fullName: true } },
  staff: { select: { id: true } },
  customRole: { select: { id: true, name: true, deletedAt: true } },
} as const satisfies Prisma.MembershipSelect;
type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
    private readonly mailer: InviteMailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  list(t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      (
        await tx.membership.findMany({
          where: { barbershopId: t.barbershopId, deletedAt: null },
          select: memberSelect,
          orderBy: { createdAt: 'asc' },
        })
      ).map(toDto),
    );
  }

  async invite(t: TenantContext, dto: InviteMemberDto) {
    if (dto.customRoleId) {
      const r = await this.prisma.run(tenantDb(t), (tx) =>
        findRole(tx, t.barbershopId, dto.customRoleId!),
      );
      dto = { ...dto, role: r.baseRole as InviteMemberDto['role'] };
    }
    this.assertCanAssignRole(t, dto.role);
    this.assertCanGrant(t, dto.permissions);
    if (dto.staff && dto.role !== 'barber')
      throw AppError.conflict('Solo los barberos tienen perfil de staff');

    const res = await this.prisma.run(tenantDb(t), async (tx) => {
      const clash = await tx.membership.findFirst({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          OR: [{ inviteEmail: dto.email, status: 'invited' }, { user: { email: dto.email } }],
        },
        select: { status: true },
      });
      if (clash) {
        throw AppError.conflict(
          clash.status === 'invited'
            ? 'Ya hay una invitación pendiente para ese email: reenvíala'
            : 'Esa persona ya es miembro',
        );
      }
      const invite = newInviteToken();
      const member = await tx.membership.create({
        data: {
          barbershopId: t.barbershopId,
          role: dto.role,
          customRoleId: dto.customRoleId ?? null,
          status: 'invited',
          permissions: dto.permissions,
          inviteEmail: dto.email,
          inviteToken: invite.hash,
          inviteExpiresAt: invite.expiresAt,
          invitedByUserId: t.userId,
        },
        select: { id: true },
      });
      if (dto.staff) {
        await this.plans.assertCanCreate(tx, t.barbershopId, 'staff');
        await tx.staff.create({
          data: {
            barbershopId: t.barbershopId,
            membershipId: member.id,
            displayName: dto.staff.displayName,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'shop.member.invite',
        barbershopId: t.barbershopId,
        entity: 'membership',
        entityId: member.id,
        diff: { email: dto.email, role: dto.role },
      });
      return {
        member: toDto(await load(tx, t.barbershopId, member.id)),
        inviteToken: invite.token,
        inviteUrl: this.inviteUrl(invite.token),
      };
    });
    await this.mailInvite(t, res.member.email, res.member.role, res.inviteUrl);
    return res;
  }

  async resendInvite(t: TenantContext, id: string) {
    const res = await this.prisma.run(tenantDb(t), async (tx) => {
      const m = await load(tx, t.barbershopId, id);
      if (m.status !== 'invited') throw AppError.conflict('La invitación ya fue aceptada');
      this.assertCanManage(t, m);
      const invite = newInviteToken();
      await tx.membership.update({
        where: { id },
        data: { inviteToken: invite.hash, inviteExpiresAt: invite.expiresAt },
      });
      await this.audit.record(tx, {
        action: 'shop.member.resend_invite',
        barbershopId: t.barbershopId,
        entity: 'membership',
        entityId: id,
      });
      return {
        member: toDto(await load(tx, t.barbershopId, id)),
        inviteToken: invite.token,
        inviteUrl: this.inviteUrl(invite.token),
      };
    });
    await this.mailInvite(t, res.member.email, res.member.role, res.inviteUrl);
    return res;
  }

  /** Correo de invitación (en segundo plano; el enlace también se muestra en pantalla). */
  private async mailInvite(t: TenantContext, to: string | null, role: string, url: string) {
    if (!to) return;
    const shop = await this.prisma.run(tenantDb(t), (tx) =>
      tx.barbershop.findUniqueOrThrow({ where: { id: t.barbershopId }, select: { name: true } }),
    );
    this.mailer.send(to, {
      shopName: shop.name,
      role,
      url,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
  }

  update(t: TenantContext, id: string, dto: UpdateMemberDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const m = await load(tx, t.barbershopId, id);
      this.assertCanManage(t, m);
      // Rol personalizado: su rol base pasa a ser el `role` del miembro. Cambiar solo `role` lo quita.
      if (dto.customRoleId) {
        const r = await findRole(tx, t.barbershopId, dto.customRoleId);
        dto = { ...dto, role: r.baseRole as NonNullable<UpdateMemberDto['role']> };
      } else if (dto.role && dto.customRoleId === undefined) {
        dto = { ...dto, customRoleId: null };
      }
      if (dto.role) this.assertCanAssignRole(t, dto.role);
      if (dto.permissions) this.assertCanGrant(t, dto.permissions);
      if (dto.status && m.status === 'invited')
        throw AppError.conflict('La invitación aún no fue aceptada');
      if (dto.role && dto.role !== 'barber' && m.staff) {
        throw AppError.conflict(
          'Este miembro tiene perfil de barbero: desvincúlalo en Staff antes de cambiar su rol',
        );
      }
      await tx.membership.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        action: 'shop.member.update',
        barbershopId: t.barbershopId,
        entity: 'membership',
        entityId: id,
        diff: dto,
      });
      return toDto(await load(tx, t.barbershopId, id));
    });
  }

  /** Quita el acceso. Si tenía perfil de staff, el perfil se conserva (historial de citas) sin login. */
  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const m = await load(tx, t.barbershopId, id);
      this.assertCanManage(t, m);
      if (m.staff)
        await tx.staff.update({ where: { id: m.staff.id }, data: { membershipId: null } });
      await tx.membership.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'disabled', inviteToken: null },
      });
      await this.audit.record(tx, {
        action: 'shop.member.remove',
        barbershopId: t.barbershopId,
        entity: 'membership',
        entityId: id,
      });
    });
  }

  private inviteUrl(token: string): string {
    return `${this.env.WEB_URL.replace(/\/$/, '')}/invitacion/${token}`;
  }

  private assertCanAssignRole(t: TenantContext, role: MemberRole): void {
    if (role === 'owner') throw AppError.forbidden('El rol owner no se asigna por invitación');
    if (role === 'admin' && t.role !== 'owner')
      throw AppError.forbidden('Solo el owner puede dar el rol admin');
  }

  private assertCanGrant(t: TenantContext, overrides: PermissionOverrides): void {
    const denied = ungrantable(t, overrides);
    if (denied.length)
      throw AppError.forbidden(`No puedes conceder permisos que no tienes: ${denied.join(', ')}`);
  }

  private assertCanManage(t: TenantContext, target: MemberRow): void {
    if (target.role === 'owner')
      throw AppError.forbidden('El owner no se puede modificar desde aquí');
    if (target.id === t.membershipId)
      throw AppError.forbidden('No puedes modificar tu propia membresía');
    if (target.role === 'admin' && t.role !== 'owner')
      throw AppError.forbidden('Solo el owner puede gestionar admins');
  }
}

async function load(tx: Tx, barbershopId: string, id: string): Promise<MemberRow> {
  const m = await tx.membership.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: memberSelect,
  });
  if (!m) throw AppError.notFound('Miembro');
  return m;
}

function toDto(m: MemberRow) {
  const perms = PermissionOverridesSchema.safeParse(m.permissions);
  return {
    id: m.id,
    role: m.role,
    status: m.status,
    email: m.user?.email ?? m.inviteEmail,
    fullName: m.user?.fullName ?? null,
    permissions: perms.success ? perms.data : {},
    staffId: m.staff?.id ?? null,
    customRole:
      m.customRole && !m.customRole.deletedAt
        ? { id: m.customRole.id, name: m.customRole.name }
        : null,
    inviteExpiresAt: m.status === 'invited' ? m.inviteExpiresAt : null,
    createdAt: m.createdAt,
  };
}
