import { Controller, Get, HttpCode, HttpStatus, Inject, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DomainRegistry } from '../domains/domain-registry';
import { classifyHost } from './tls-ask';

/**
 * Caddy pregunta aquí antes de emitir un certificado on-demand: 200 = emitir, 404 = no.
 * Evita que cualquiera nos haga pedir certificados para subdominios inventados.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('public/tls')
export class TlsAskController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly domains: DomainRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('ask')
  @HttpCode(HttpStatus.OK)
  async ask(@Query('domain') domain = ''): Promise<{ ok: true }> {
    const r = classifyHost(String(domain), this.env.ROOT_DOMAIN);
    if (r.kind === 'platform') return { ok: true };
    if (r.kind === 'shop') {
      const shop = await this.prisma.run({ kind: 'system' }, (tx) =>
        tx.barbershop.findFirst({ where: { slug: r.slug, deletedAt: null }, select: { id: true } }),
      );
      if (shop) return { ok: true };
    }
    // Dominio propio de una barbería, solo si ya está verificado.
    if (r.kind === 'reject' && (await this.domains.slugFor(String(domain)))) return { ok: true };
    throw AppError.notFound('Dominio');
  }
}
