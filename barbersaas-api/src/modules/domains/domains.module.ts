import { Global, Module } from '@nestjs/common';
import { DNS_RESOLVER, systemResolver } from './dns-resolver';
import { DomainRegistry } from './domain-registry';
import { PublicDomainController, ShopDomainController } from './domains.controller';
import { DomainsService } from './domains.service';

/** Global: CORS (main) y TLS (edge) consultan el registro de dominios verificados. */
@Global()
@Module({
  controllers: [ShopDomainController, PublicDomainController],
  providers: [
    DomainsService,
    DomainRegistry,
    { provide: DNS_RESOLVER, useFactory: systemResolver },
  ],
  exports: [DomainRegistry],
})
export class DomainsModule {}
