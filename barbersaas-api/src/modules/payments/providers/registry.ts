import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../../config/config.module';
import type { Env } from '../../../config/env';
import type { GatewayProvider } from '../../../generated/prisma/enums';
import { izipay } from './izipay';
import { mercadoPago } from './mercadopago';
import { simulator } from './simulator';
import type { ShopGateway } from './types';

/** Pasarelas disponibles para las barberías. El simulador no existe en producción. */
@Injectable()
export class GatewayRegistry {
  private readonly all: Map<GatewayProvider, ShopGateway>;

  constructor(@Inject(ENV) private readonly env: Env) {
    const list: ShopGateway[] = [mercadoPago, izipay];
    if (env.NODE_ENV !== 'production') list.unshift(simulator(env.PUBLIC_API_URL));
    this.all = new Map(list.map((g) => [g.id, g]));
  }

  list(): ShopGateway[] {
    return [...this.all.values()];
  }

  get(id: GatewayProvider): ShopGateway | undefined {
    return this.all.get(id);
  }
}
