import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../../common/auth/decorators';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { ReasonDto } from '../barbershops/platform-barbershops.dto';
import {
  CreateInvoiceDto,
  InvoiceDto,
  InvoiceListDto,
  ListInvoicesQueryDto,
  MarkPaidDto,
} from './platform-billing.dto';
import { PlatformBillingService } from './platform-billing.service';

/** Facturación: solo superadmin (soporte no tiene acceso). */
@ApiTags('platform · billing')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform')
export class PlatformBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  @Get('invoices')
  @ZodResponse({ type: InvoiceListDto })
  list(@CurrentUser() u: AuthUser, @Query() q: ListInvoicesQueryDto) {
    return this.billing.list(u, q);
  }

  @Post('barbershops/:id/invoices')
  @ZodResponse({ type: InvoiceDto, status: 201 })
  create(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.billing.create(u, id, dto);
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: InvoiceDto })
  markPaid(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.billing.markPaid(u, id, dto);
  }

  @Post('invoices/:id/void')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: InvoiceDto })
  void(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string, @Body() dto: ReasonDto) {
    return this.billing.void(u, id, dto.reason);
  }
}
