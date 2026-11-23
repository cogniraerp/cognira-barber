import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthUser } from '../../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../../common/auth/decorators';
import { platformDb } from '../../../common/auth/platform-db';
import { IsoDate, pageArgs, paginated, PaginationQuerySchema } from '../../../common/http/zod';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';

const QuerySchema = PaginationQuerySchema.extend({
  barbershopId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  /** Prefijo: "platform." filtra todas las acciones de plataforma. */
  action: z.string().trim().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
class AuditQueryDto extends createZodDto(QuerySchema) {}

const AuditLogSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  barbershopId: z.uuid().nullable(),
  actorUserId: z.uuid().nullable(),
  impersonatorUserId: z.uuid().nullable(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  diff: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: IsoDate,
});
class AuditLogListDto extends createZodDto(paginated(AuditLogSchema), { codec: true }) {}

@ApiTags('platform · audit')
@ApiBearerAuth()
@PlatformRoles('superadmin', 'support')
@Controller('platform/audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ type: AuditLogListDto })
  async list(@CurrentUser() u: AuthUser, @Query() q: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.barbershopId ? { barbershopId: q.barbershopId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.run(platformDb(u), (tx) =>
      Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.auditLog.count({ where }),
      ]),
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
