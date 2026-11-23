import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ description: 'API y base de datos operativas' })
  async check(): Promise<{ status: 'ok'; db: 'ok'; time: string }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok', time: new Date().toISOString() };
  }
}
