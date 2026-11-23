import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { sanitizeRolePermissions, type Permission } from '../../../common/rbac/permissions';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import type { MemberRole } from '../../../generated/prisma/enums';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import type { CreateShopRoleDto, UpdateShopRoleDto } from './roles.dto';

const roleSelect = {
  id: true,
  name: true,
  description: true,
  baseRole: true,
  permissions: true,
  createdAt: true,
  _count: { select: { memberships: { where: { deletedAt: null } } } },
} as const;

/**
 * Roles personalizados de la barbería. Reglas:
 *  - solo el owner crea/edita roles con base "admin";
 *  - quien no es owner solo puede conceder permisos que él mismo tiene (al crear: todos;
 *    al editar: solo los que AGREGA, no los que ya tenía el rol);
 *  - nombre único por barbería (sin distinguir mayúsculas);
 *  - eliminar un rol deja a sus miembros con su rol base.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      (
        await tx.shopRole.findMany({
          where: { barbershopId: t.barbershopId, deletedAt: null },
          select: roleSelect,
          orderBy: { name: 'asc' },
        })
      ).map(toDto),
    );
  }

  create(t: TenantContext, dto: CreateShopRoleDto) {
    this.assertBase(t, dto.baseRole);
    const permissions = sanitizeRolePermissions(dto.permissions);
    this.assertCanGrant(t, permissions);
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.assertUniqueName(tx, t.barbershopId, dto.name);
      const r = await tx.shopRole.create({
        data: {
          barbershopId: t.barbershopId,
          name: dto.name,
          description: dto.description,
          baseRole: dto.baseRole,
          permissions,
        },
        select: roleSelect,
      });
      await this.audit.record(tx, {
        action: 'shop.role.create',
        barbershopId: t.barbershopId,
        entity: 'shop_role',
        entityId: r.id,
        diff: { name: dto.name, baseRole: dto.baseRole, permissions },
      });
      return toDto(r);
    });
  }

  update(t: TenantContext, id: string, dto: UpdateShopRoleDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const current = await find(tx, t.barbershopId, id);
      this.assertBase(t, current.baseRole);
      if (dto.baseRole) this.assertBase(t, dto.baseRole);
      if (dto.baseRole && dto.baseRole !== current.baseRole && dto.baseRole !== 'barber') {
        const withStaff = await tx.membership.count({
          where: { customRoleId: id, deletedAt: null, staff: { isNot: null } },
        });
        if (withStaff)
          throw AppError.conflict(
            `${withStaff} miembro(s) con este rol tienen perfil de barbero: el rol base debe seguir siendo "barbero"`,
          );
      }
      const permissions = dto.permissions ? sanitizeRolePermissions(dto.permissions) : undefined;
      if (permissions) {
        const before = new Set(current.permissions);
        this.assertCanGrant(
          t,
          permissions.filter((p) => !before.has(p)),
        );
      }
      if (dto.name && dto.name.toLowerCase() !== current.name.toLowerCase())
        await this.assertUniqueName(tx, t.barbershopId, dto.name);
      const r = await tx.shopRole.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.baseRole ? { baseRole: dto.baseRole } : {}),
          ...(permissions ? { permissions } : {}),
        },
        select: roleSelect,
      });
      // El rol base de los miembros acompaña al del rol (define su jerarquía).
      if (dto.baseRole && dto.baseRole !== current.baseRole) {
        await tx.membership.updateMany({
          where: { customRoleId: id, deletedAt: null },
          data: { role: dto.baseRole },
        });
      }
      await this.audit.record(tx, {
        action: 'shop.role.update',
        barbershopId: t.barbershopId,
        entity: 'shop_role',
        entityId: id,
        diff: { ...dto, permissions },
      });
      return toDto(r);
    });
  }

  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const current = await find(tx, t.barbershopId, id);
      this.assertBase(t, current.baseRole);
      const { count } = await tx.membership.updateMany({
        where: { customRoleId: id, deletedAt: null },
        data: { customRoleId: null },
      });
      await tx.shopRole.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'shop.role.delete',
        barbershopId: t.barbershopId,
        entity: 'shop_role',
        entityId: id,
        diff: { name: current.name, reassigned: count },
      });
      return { reassigned: count };
    });
  }

  private assertBase(t: TenantContext, base: MemberRole): void {
    if (base === 'admin' && t.role !== 'owner')
      throw AppError.forbidden('Solo el owner gestiona roles con nivel de administrador');
  }

  private assertCanGrant(t: TenantContext, perms: Permission[]): void {
    if (t.role === 'owner') return;
    const denied = perms.filter((p) => !t.permissions.has(p));
    if (denied.length)
      throw AppError.forbidden(`No puedes conceder permisos que no tienes: ${denied.join(', ')}`);
  }

  private async assertUniqueName(tx: Tx, barbershopId: string, name: string): Promise<void> {
    const clash = await tx.shopRole.findFirst({
      where: { barbershopId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw AppError.conflict(`Ya existe un rol llamado "${name}"`, ErrorCode.CONFLICT);
  }
}

export async function find(tx: Tx, barbershopId: string, id: string) {
  const r = await tx.shopRole.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: { id: true, name: true, baseRole: true, permissions: true },
  });
  if (!r) throw AppError.notFound('Rol');
  return r;
}

function toDto(r: {
  id: string;
  name: string;
  description: string | null;
  baseRole: MemberRole;
  permissions: string[];
  createdAt: Date;
  _count: { memberships: number };
}) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    baseRole: r.baseRole as 'admin' | 'receptionist' | 'barber',
    permissions: sanitizeRolePermissions(r.permissions),
    members: r._count.memberships,
    createdAt: r.createdAt,
  };
}
