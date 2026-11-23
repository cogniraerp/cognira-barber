import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import { SignupService } from './signup.service';

const AvailabilitySchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  reason: z.enum(['invalid', 'reserved', 'taken']).optional(),
  suggestion: z.string().optional(),
});
class AvailabilityDto extends createZodDto(AvailabilitySchema) {}

@ApiTags('público')
@Public()
@Controller('public/slugs')
export class PublicSlugController {
  constructor(private readonly signup: SignupService) {}

  /** Para el formulario de alta: comprueba en vivo si el subdominio está libre y sugiere otro. */
  @Get(':slug/availability')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ZodResponse({ type: AvailabilityDto })
  availability(@Param('slug') slug: string) {
    return this.signup.availability(slug.slice(0, 60));
  }
}
