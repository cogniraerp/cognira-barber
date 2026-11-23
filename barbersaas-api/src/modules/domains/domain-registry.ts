import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

const TTL_MS = 60_000;

/**
 * ¿Qué barbería tiene verificado este hostname? Con caché de 1 minuto: lo consultan CORS (en cada
 * request con Origin) y Caddy (en cada certificado nuevo).
 */
@Injectable()
export class DomainRegistry {
  private readonly cache = new Map<string, { slug: string | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async slugFor(host: string): Promise<string | null> {
    const h = host.trim().toLowerCase().replace(/\.$/, '');
    if (!h || h.length > 253) return null;
    const hit = this.cache.get(h);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.slug;
    const rows = await this.prisma.run(
      { kind: 'system' },
      (tx) =>
        tx.$queryRaw<Array<{ slug: string }>>`
        SELECT slug FROM barbershops
        WHERE lower(custom_domain) = ${h} AND custom_domain_verified_at IS NOT NULL AND deleted_at IS NULL
        LIMIT 1`,
    );
    const slug = rows[0]?.slug ?? null;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(h, { slug, at: Date.now() });
    return slug;
  }

  forget(host: string | null | undefined): void {
    if (host) this.cache.delete(host.toLowerCase());
  }
}
