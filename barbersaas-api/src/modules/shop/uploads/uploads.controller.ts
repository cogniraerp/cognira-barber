import { randomUUID } from 'node:crypto';
import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import type {} from 'multer'; // tipos de Express.Multer.File
import { z } from 'zod';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { PlanLimitsService } from '../../../common/plan-limits/plan-limits.service';
import type { Permission } from '../../../common/rbac/permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import { can, tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { detectImageType } from '../../../infra/storage/image-type';
import { StorageProvider } from '../../../infra/storage/storage.provider';

const MB = 1024 * 1024;
const KINDS = {
  logo: { perm: 'shop.manage', maxBytes: 2 * MB },
  favicon: { perm: 'shop.manage', maxBytes: 512 * 1024 },
  banner: { perm: 'shop.manage', maxBytes: 5 * MB },
  gallery: { perm: 'shop.manage', maxBytes: 5 * MB },
  staff: { perm: 'staff.manage', maxBytes: 2 * MB },
  service: { perm: 'services.manage', maxBytes: 2 * MB },
  /** Fotos del corte en la ficha del cliente. */
  customer: { perm: 'customers.view', maxBytes: 5 * MB },
} as const satisfies Record<string, { perm: Permission; maxBytes: number }>;
type Kind = keyof typeof KINDS;

const UploadQuerySchema = z.object({ kind: z.enum(Object.keys(KINDS) as [Kind, ...Kind[]]) });
class UploadQueryDto extends createZodDto(UploadQuerySchema) {}

const UploadResultSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  key: z.string(),
  kind: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
});
class UploadResultDto extends createZodDto(UploadResultSchema) {}

@ApiTags('shop · archivos')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/uploads')
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageProvider,
    private readonly plans: PlanLimitsService,
  ) {}

  /** Sube una imagen (PNG, JPEG, WEBP o ICO para favicon). Devuelve la URL pública para usarla en marca, galería, etc. */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  // Sin `storage`: multer guarda en memoria (Buffer), que es lo que necesitamos para validar el contenido.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * MB, files: 1 } }))
  @ZodResponse({ type: UploadResultDto, status: 201 })
  async upload(
    @CurrentTenant() t: TenantContext,
    @Query() { kind }: UploadQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    const rule = KINDS[kind];
    if (!can(t, rule.perm))
      throw new AppError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'No tienes permiso para esta acción',
        { missing: [rule.perm] },
      );
    if (!file) throw invalid('Falta el archivo (campo "file")');
    if (file.size > rule.maxBytes)
      throw invalid(`El archivo supera ${Math.round(rule.maxBytes / 1024)} KB`);
    const type = detectImageType(file.buffer);
    if (!type || (type.ext === 'ico' && kind !== 'favicon'))
      throw invalid('Formato no soportado: usa PNG, JPG o WEBP');

    const { limits } = await this.plans.entitlements(t.barbershopId);
    if (limits.storageMb !== null) {
      const used = await this.prisma.run(tenantDb(t), (tx) =>
        tx.storedFile.aggregate({
          where: { barbershopId: t.barbershopId, deletedAt: null },
          _sum: { sizeBytes: true },
        }),
      );
      if ((used._sum.sizeBytes ?? 0) + file.size > limits.storageMb * MB) {
        throw new AppError(
          ErrorCode.PLAN_LIMIT_REACHED,
          HttpStatus.PAYMENT_REQUIRED,
          'Alcanzaste el almacenamiento de tu plan',
          {
            limit: 'storageMb',
            max: limits.storageMb,
          },
        );
      }
    }

    const key = `${t.barbershopId}/${kind}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    try {
      const row = await this.prisma.run(tenantDb(t), (tx) =>
        tx.storedFile.create({
          data: {
            barbershopId: t.barbershopId,
            key,
            kind,
            contentType: type.mime,
            sizeBytes: file.size,
            uploadedById: t.userId,
          },
          select: { id: true, key: true, kind: true, contentType: true, sizeBytes: true },
        }),
      );
      return { ...row, url: this.storage.publicUrl(key) };
    } catch (e) {
      await this.storage.delete(key);
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    const file = await this.prisma.run(tenantDb(t), async (tx) => {
      const f = await tx.storedFile.findFirst({
        where: { id, barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true, key: true, kind: true },
      });
      if (!f) throw AppError.notFound('Archivo');
      if (!can(t, KINDS[f.kind as Kind]?.perm ?? 'shop.manage')) throw AppError.forbidden();
      await tx.storedFile.update({ where: { id }, data: { deletedAt: new Date() } });
      return f;
    });
    await this.storage.delete(file.key);
  }
}

function invalid(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, message, {
    errors: [{ path: 'file', message }],
  });
}
