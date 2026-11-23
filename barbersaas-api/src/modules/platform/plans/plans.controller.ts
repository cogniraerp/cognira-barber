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
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../../../common/auth/auth.types';
import { CurrentUser, PlatformRoles } from '../../../common/auth/decorators';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { CreatePlanDto, PlanDto, PlanListDto, UpdatePlanDto } from './plans.dto';
import { PlansService } from './plans.service';

@ApiTags('platform · plans')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @PlatformRoles('superadmin', 'support')
  @ZodResponse({ type: PlanListDto })
  list(@CurrentUser() u: AuthUser) {
    return this.plans.list(u);
  }

  @Get(':id')
  @PlatformRoles('superadmin', 'support')
  @ZodResponse({ type: PlanDto })
  get(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.plans.get(u, id);
  }

  @Post()
  @ZodResponse({ type: PlanDto, status: 201 })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePlanDto) {
    return this.plans.create(u, dto);
  }

  @Patch(':id')
  @ZodResponse({ type: PlanDto })
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plans.update(u, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@CurrentUser() u: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.plans.remove(u, id);
  }
}
