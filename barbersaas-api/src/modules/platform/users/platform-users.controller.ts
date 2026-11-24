import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { PlatformRoles } from '../../../common/auth/decorators';
import { UuidPipe } from '../../../common/http/uuid.pipe';
import { AccountRecoveryService } from '../../auth/account-recovery.service';
import { EmailVerifiedDto, ResetLinkDto } from './platform-users.dto';

/**
 * Vía manual de cuentas (solo superadmin), útil mientras el correo no está configurado o no le
 * llega al usuario: confirmar su correo y generar un enlace de contraseña para enviarlo por WhatsApp.
 */
@ApiTags('platform')
@ApiBearerAuth()
@PlatformRoles('superadmin')
@Controller('platform/users')
export class PlatformUsersController {
  constructor(private readonly recovery: AccountRecoveryService) {}

  @Post(':id/verify-email')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: EmailVerifiedDto })
  verifyEmail(@Param('id', UuidPipe) id: string) {
    return this.recovery.markVerifiedByAdmin(id);
  }

  @Post(':id/reset-link')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ type: ResetLinkDto })
  resetLink(@Param('id', UuidPipe) id: string) {
    return this.recovery.resetLinkByAdmin(id);
  }
}
