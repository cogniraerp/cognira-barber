import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { PlanLimitsService } from '../../../common/plan-limits/plan-limits.service';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { StorageProvider } from '../../../infra/storage/storage.provider';
import { assertOwnFile } from '../own-file';
import { assertSameSet, badRequest } from '../shop-helpers';
import type { CreateServiceDto, ServicesQueryDto, UpdateServiceDto } from './services.dto';

export const serviceSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  categoryId: true,
  priceCents: true,
  durationMin: true,
  bufferBeforeMin: true,
  bufferAfterMin: true,
  isOnlineBookable: true,
  depositOverride: true,
  isActive: true,
  sortOrder: true,
  staffServices: {
    where: { staff: { deletedAt: null } },
    select: {
      staffId: true,
      priceCentsOverride: true,
      durationMinOverride: true,
      staff: { select: { displayName: true, sortOrder: true } },
    },
  },
} as const satisfies Prisma.ServiceSelect;
type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanLimitsService,
    private readonly storage: StorageProvider,
  ) {}

  // ─────────────── Categorías ───────────────
  async listCategories(t: TenantContext) {
    const rows = await this.prisma.run(tenantDb(t), (tx) =>
      tx.serviceCategory.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: {
          id: true,
          name: true,
          sortOrder: true,
          _count: { select: { services: { where: { deletedAt: null } } } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map(({ _count, ...c }) => ({ ...c, servicesCount: _count.services }));
  }

  createCategory(t: TenantContext, name: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const sortOrder = await tx.serviceCategory.count({
        where: { barbershopId: t.barbershopId, deletedAt: null },
      });
      const c = await tx.serviceCategory.create({
        data: { barbershopId: t.barbershopId, name, sortOrder },
        select: { id: true, name: true, sortOrder: true },
      });
      return { ...c, servicesCount: 0 };
    });
  }

  async renameCategory(t: TenantContext, id: string, name: string) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      await findCategory(tx, t.barbershopId, id);
      await tx.serviceCategory.update({ where: { id }, data: { name } });
    });
    return (await this.listCategories(t)).find((c) => c.id === id)!;
  }

  /** Los servicios de la categoría quedan "sin categoría" (no se borran). */
  removeCategory(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findCategory(tx, t.barbershopId, id);
      await tx.service.updateMany({
        where: { barbershopId: t.barbershopId, categoryId: id },
        data: { categoryId: null },
      });
      await tx.serviceCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async reorderCategories(t: TenantContext, ids: string[]) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      const all = await tx.serviceCategory.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      assertSameSet(
        ids,
        all.map((c) => c.id),
      );
      await Promise.all(
        ids.map((id, i) => tx.serviceCategory.update({ where: { id }, data: { sortOrder: i } })),
      );
    });
    return this.listCategories(t);
  }

  // ─────────────── Servicios ───────────────
  async list(t: TenantContext, q: ServicesQueryDto) {
    const rows = await this.prisma.run(tenantDb(t), (tx) =>
      tx.service.findMany({
        where: {
          barbershopId: t.barbershopId,
          deletedAt: null,
          ...(q.includeInactive === 'true' ? {} : { isActive: true }),
          ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        },
        select: serviceSelect,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map(toDto);
  }

  get(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) =>
      toDto(await findService(tx, t.barbershopId, id)),
    );
  }

  create(t: TenantContext, dto: CreateServiceDto) {
    assertOwnFile(this.storage, t.barbershopId, dto.imageUrl, 'imageUrl');
    const { staffIds, depositOverride, ...rest } = dto;
    const data = { ...rest, depositOverride: jsonOrNull(depositOverride) };
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.plans.assertCanCreate(tx, t.barbershopId, 'services');
      if (data.categoryId) await findCategory(tx, t.barbershopId, data.categoryId);
      const sortOrder = await tx.service.count({
        where: { barbershopId: t.barbershopId, deletedAt: null },
      });
      const svc = await tx.service.create({
        data: { ...data, barbershopId: t.barbershopId, sortOrder },
        select: { id: true },
      });
      if (staffIds?.length) {
        await assertStaffExist(tx, t.barbershopId, staffIds);
        await tx.staffService.createMany({
          data: staffIds.map((staffId) => ({
            barbershopId: t.barbershopId,
            staffId,
            serviceId: svc.id,
          })),
        });
      }
      await this.audit.record(tx, {
        action: 'shop.service.create',
        barbershopId: t.barbershopId,
        entity: 'service',
        entityId: svc.id,
        diff: dto,
      });
      return toDto(await findService(tx, t.barbershopId, svc.id));
    });
  }

  update(t: TenantContext, id: string, dto: UpdateServiceDto) {
    assertOwnFile(this.storage, t.barbershopId, dto.imageUrl, 'imageUrl');
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findService(tx, t.barbershopId, id);
      if (dto.categoryId) await findCategory(tx, t.barbershopId, dto.categoryId);
      const { depositOverride, ...rest } = dto;
      await tx.service.update({
        where: { id },
        data: {
          ...rest,
          ...(depositOverride !== undefined
            ? { depositOverride: jsonOrNull(depositOverride) }
            : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'shop.service.update',
        barbershopId: t.barbershopId,
        entity: 'service',
        entityId: id,
        diff: dto,
      });
      return toDto(await findService(tx, t.barbershopId, id));
    });
  }

  /**
   * Soft delete. Las citas ya agendadas conservan el servicio (guardan nombre/precio/duración
   * en appointment_services), así que no se bloquea el borrado.
   */
  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findService(tx, t.barbershopId, id);
      await tx.staffService.deleteMany({ where: { barbershopId: t.barbershopId, serviceId: id } });
      await tx.service.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await this.audit.record(tx, {
        action: 'shop.service.delete',
        barbershopId: t.barbershopId,
        entity: 'service',
        entityId: id,
      });
    });
  }

  async reorder(t: TenantContext, ids: string[]) {
    await this.prisma.run(tenantDb(t), async (tx) => {
      const all = await tx.service.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      assertSameSet(
        ids,
        all.map((s) => s.id),
      );
      await Promise.all(
        ids.map((id, i) => tx.service.update({ where: { id }, data: { sortOrder: i } })),
      );
    });
    return this.list(t, { includeInactive: 'true' });
  }
}

export async function findService(tx: Tx, barbershopId: string, id: string): Promise<ServiceRow> {
  const s = await tx.service.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: serviceSelect,
  });
  if (!s) throw AppError.notFound('Servicio');
  return s;
}

async function findCategory(tx: Tx, barbershopId: string, id: string) {
  const c = await tx.serviceCategory.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: { id: true },
  });
  if (!c) throw badRequest('categoryId', 'Categoría inexistente');
}

export async function assertStaffExist(tx: Tx, barbershopId: string, ids: string[]): Promise<void> {
  const n = await tx.staff.count({ where: { barbershopId, id: { in: ids }, deletedAt: null } });
  if (n !== new Set(ids).size) throw badRequest('staffIds', 'Algún barbero no existe');
}

/** null en una columna Json se guarda como NULL de SQL. */
const jsonOrNull = (v: object | null) =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonObject);

function toDto({ staffServices, depositOverride, ...s }: ServiceRow) {
  return {
    ...s,
    depositOverride: (depositOverride ?? null) as {
      required: boolean;
      type: 'percent' | 'fixed' | 'full';
      value: number;
    } | null,
    staff: staffServices
      .sort((a, b) => a.staff.sortOrder - b.staff.sortOrder)
      .map((ss) => ({
        staffId: ss.staffId,
        displayName: ss.staff.displayName,
        priceCents: ss.priceCentsOverride ?? s.priceCents,
        durationMin: ss.durationMinOverride ?? s.durationMin,
        isOverridden: ss.priceCentsOverride !== null || ss.durationMinOverride !== null,
      })),
  };
}
