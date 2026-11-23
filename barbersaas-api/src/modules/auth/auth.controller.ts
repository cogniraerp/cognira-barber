import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../../common/auth/decorators';
import { AccountRecoveryService } from './account-recovery.service';
import { AuthService } from './auth.service';
import {
  AuthTokensDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

/** Límite estricto para endpoints de credenciales (por IP). */
/** Intentos de registro/login por IP y minuto (anti fuerza bruta). Configurable para los E2E. */
const AUTH_THROTTLE = {
  default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 },
};

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly recovery: AccountRecoveryService,
  ) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ZodResponse({ type: AuthTokensDto, status: 201 })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ZodResponse({ type: AuthTokensDto, status: 200 })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ZodResponse({ type: AuthTokensDto, status: 200 })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /** Siempre 204, exista o no la cuenta (no revela qué correos están registrados). */
  @Post('password/forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  @ApiNoContentResponse()
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.recovery.forgotPassword(dto.email);
  }

  /** Con el token del correo: nueva contraseña; cierra todas las sesiones. */
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.recovery.resetPassword(dto.token, dto.password);
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  @ApiNoContentResponse()
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.recovery.verifyEmail(dto.token);
  }
}
