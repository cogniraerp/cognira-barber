import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import { ReportExportQueryDto, ReportOverviewDto, ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('shop · reportes')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  /** KPIs con comparación al período anterior y desgloses por día, barbero, servicio, producto y método. */
  @Get('overview')
  @RequirePermissions('reports.view')
  @ZodResponse({ type: ReportOverviewDto })
  overview(@CurrentTenant() t: TenantContext, @Query() q: ReportQueryDto) {
    return this.svc.overview(t, q);
  }

  /** CSV para Excel (UTF-8 con BOM) de una sección del reporte. */
  @Get('export.csv')
  @RequirePermissions('reports.view')
  @ApiProduces('text/csv')
  async export(
    @CurrentTenant() t: TenantContext,
    @Query() q: ReportExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.svc.exportCsv(t, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte-${q.section}-${q.from}_${q.to}.csv"`,
    );
    return csv;
  }
}
