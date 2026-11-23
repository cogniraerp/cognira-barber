import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermissions } from '../../../common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../../common/tenancy/decorators';
import type { TenantContext } from '../../../common/tenancy/tenant.types';
import { ONBOARDING_STEPS, OnboardingService } from './onboarding.service';

const OnboardingSchema = z.object({
  status: z.enum(['onboarding', 'active', 'suspended', 'deleted']),
  steps: z.array(
    z.object({ key: z.enum(ONBOARDING_STEPS), required: z.boolean(), done: z.boolean() }),
  ),
  progress: z.number().int().min(0).max(100),
  canActivate: z.boolean(),
  dismissed: z.boolean(),
  bookingUrl: z.string(),
});
class OnboardingDto extends createZodDto(OnboardingSchema) {}

const UpdateOnboardingSchema = z
  .object({ completeStep: z.enum(['branding', 'whatsapp', 'share']), dismissed: z.boolean() })
  .partial();
class UpdateOnboardingDto extends createZodDto(UpdateOnboardingSchema) {}

/**
 * Wizard: 1 datos → 2 logo y colores → 3 horarios → 4 servicios → 5 barberos → 6 WhatsApp → 7 compartir enlace.
 * Los pasos 1, 3, 4 y 5 se marcan solos al cargar los datos; 2, 6 y 7 se pueden marcar/saltar.
 */
@ApiTags('shop · onboarding')
@ApiBearerAuth()
@TenantScoped()
@Controller('shop/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ZodResponse({ type: OnboardingDto })
  get(@CurrentTenant() t: TenantContext) {
    return this.onboarding.get(t);
  }

  @Patch()
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: OnboardingDto })
  update(@CurrentTenant() t: TenantContext, @Body() dto: UpdateOnboardingDto) {
    return this.onboarding.update(t, dto);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shop.manage')
  @ZodResponse({ type: OnboardingDto })
  activate(@CurrentTenant() t: TenantContext) {
    return this.onboarding.activate(t);
  }
}
