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
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import {
  InviteMemberDto,
  InviteResultDto,
  MemberDto,
  MemberListDto,
  UpdateMemberDto,
} from './members.dto';
import { MembersService } from './members.service';

@ApiTags('shop · usuarios y permisos')
@ApiBearerAuth()
@TenantScoped()
@RequirePermissions('members.manage')
@Controller('shop/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ZodResponse({ type: MemberListDto })
  list(@CurrentTenant() t: TenantContext) {
    return this.members.list(t);
  }

  @Post('invite')
  @ZodResponse({ type: InviteResultDto, status: 201 })
  invite(@CurrentTenant() t: TenantContext, @Body() dto: InviteMemberDto) {
    return this.members.invite(t, dto);
  }

  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: InviteResultDto })
  resend(@CurrentTenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.members.resendInvite(t, id);
  }

  @Patch(':id')
  @ZodResponse({ type: MemberDto })
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.update(t, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @CurrentTenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
  ): Promise<void> {
    await this.members.remove(t, id);
  }
}
