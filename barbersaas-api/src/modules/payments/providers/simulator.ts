import { z } from 'zod';
import type { ShopGateway } from './types';

export const SimulatorCredentials = z.object({}).strict();

/**
 * Pasarela simulada para desarrollo y pruebas: genera un checkout local (servido por la API) con
 * "Pagar" y "Rechazar". No mueve dinero. Deshabilitada en producción.
 */
export function simulator(publicApiUrl: string): ShopGateway<Record<string, never>> {
  return {
    id: 'simulator',
    name: 'Simulador (pruebas)',
    devOnly: true,
    credentials: SimulatorCredentials,
    fields: [],
    publicInfo: () => ({}),
    modeOf: () => 'test',
    verify: () => Promise.resolve({ account: 'Simulador local' }),
    createCharge: (_c, req) =>
      Promise.resolve({
        providerRef: `sim_${req.chargeId.slice(0, 8)}`,
        checkoutUrl: `${publicApiUrl}/v1/public/pay/simulator/${req.chargeId}?sig=${req.simulatorSig}`,
      }),
    // El estado lo fija el propio checkout simulado; consultar no cambia nada.
    fetchStatus: () => Promise.resolve({ status: 'pending', paymentId: null }),
    parseWebhook: () => null,
    resolveChargeId: () => Promise.resolve(null),
    refund: (_c, req) => Promise.resolve({ refundId: `sim_ref_${req.idempotencyKey.slice(0, 8)}` }),
  };
}
