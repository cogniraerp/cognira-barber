import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type {} from 'multer';
import { ZodResponse } from 'nestjs-zod';
import { PaginationQuerySchema } from '../../common/http/zod';
import { UuidPipe } from '../../common/http/uuid.pipe';
import { RequirePermissions } from '../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../common/tenancy/decorators';
import type { TenantContext } from '../../common/tenancy/tenant.types';
import { badRequest } from '../shop/shop-helpers';
import {
  BlockDto,
  CreateCustomerDto,
  CreateNoteDto,
  CustomerDto,
  CustomerListDto,
  HistoryDto,
  ImportQueryDto,
  ImportResultDto,
  ListCustomersQueryDto,
  MergeDto,
  NoteDto,
  NoteListDto,
  TagsDto,
  UpdateCustomerDto,
} from './customers.dto';
import { CustomersService } from './customers.service';
import { createZodDto } from 'nestjs-zod';

class PageQueryDto extends createZodDto(PaginationQuerySchema) {}

@ApiTags('shop · clientes')
@ApiBearerAuth()
@TenantScoped()
@RequirePermissions('customers.view')
@Controller('shop/customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  @ZodResponse({ type: CustomerListDto })
  list(@CurrentTenant() t: TenantContext, @Query() q: ListCustomersQueryDto) {
    return this.svc.list(t, q);
  }

  @Get('tags')
  @ZodResponse({ type: TagsDto })
  tags(@CurrentTenant() t: TenantContext) {
    return this.svc.tags(t);
  }

  /** CSV para Excel (UTF-8 con BOM). Contactos enmascarados si el rol no puede verlos. */
  @Get('export.csv')
  @RequirePermissions('customers.view', 'customers.export')
  @ApiProduces('text/csv')
  async export(
    @CurrentTenant() t: TenantContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.svc.exportCsv(t);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clientes-${t.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  /**
   * Importa clientes desde CSV (columnas: nombre, telefono, email, cumpleanos, etiquetas, notas;
   * el encabezado se reconoce con o sin tildes). Upsert por teléfono o email. `?dryRun=true` valida sin guardar.
   */
  @Post('import')
  @RequirePermissions('customers.view', 'customers.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ImportResultDto })
  import(
    @CurrentTenant() t: TenantContext,
    @Query() q: ImportQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw badRequest('file', 'Falta el archivo CSV (campo "file")');
    return this.svc.importCsv(t, decodeText(file.buffer), q.dryRun === 'true');
  }

  @Post()
  @RequirePermissions('customers.view', 'customers.manage')
  @ZodResponse({ type: CustomerDto, status: 201 })
  create(@CurrentTenant() t: TenantContext, @Body() dto: CreateCustomerDto) {
    return this.svc.create(t, dto);
  }

  @Get(':id')
  @ZodResponse({ type: CustomerDto })
  get(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.get(t, id);
  }

  @Patch(':id')
  @RequirePermissions('customers.view', 'customers.manage')
  @ZodResponse({ type: CustomerDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.svc.update(t, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customers.view', 'customers.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(t, id);
  }

  @Post(':id/block')
  @RequirePermissions('customers.view', 'customers.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: CustomerDto })
  block(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: BlockDto,
  ) {
    return this.svc.setBlocked(t, id, true, dto.reason);
  }

  @Post(':id/unblock')
  @RequirePermissions('customers.view', 'customers.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: CustomerDto })
  unblock(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.setBlocked(t, id, false);
  }

  /** Fusiona el cliente `sourceId` dentro de este (el origen se elimina). */
  @Post(':id/merge')
  @RequirePermissions('customers.view', 'customers.manage')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: CustomerDto })
  merge(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: MergeDto,
  ) {
    return this.svc.merge(t, id, dto.sourceId);
  }

  @Get(':id/appointments')
  @ZodResponse({ type: HistoryDto })
  history(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query() q: PageQueryDto,
  ) {
    return this.svc.history(t, id, q);
  }

  @Get(':id/notes')
  @ZodResponse({ type: NoteListDto })
  notes(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.svc.notes(t, id);
  }

  /** Cualquier miembro que vea al cliente puede anotar ("degradado bajo, máquina 1") y adjuntar foto del corte. */
  @Post(':id/notes')
  @ZodResponse({ type: NoteDto, status: 201 })
  addNote(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.svc.addNote(t, id, dto.body, dto.imageUrl);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeNote(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('noteId', UuidPipe) noteId: string,
  ): Promise<void> {
    await this.svc.removeNote(t, id, noteId);
  }
}

/** UTF-8 si es válido; si no, Windows-1252/Latin-1 (lo que suele guardar Excel en Windows). */
export function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}
