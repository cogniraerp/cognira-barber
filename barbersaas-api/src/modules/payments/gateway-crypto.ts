import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Lo que se guarda cifrado: credenciales del proveedor + token de la URL del webhook. */
export interface SealedAccount {
  creds: Record<string, unknown>;
  webhookToken: string;
}

export const newWebhookToken = () => randomBytes(24).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Firma del checkout simulado (evita que cualquiera marque un cobro como pagado). */
export function simulatorSig(key: string, chargeId: string): string {
  return createHmac('sha256', key).update(`sim:${chargeId}`).digest('base64url');
}

export function checkSimulatorSig(key: string, chargeId: string, sig: string): boolean {
  const a = Buffer.from(simulatorSig(key, chargeId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
