import type { z } from 'zod';
import type { GatewayProvider } from '../../../generated/prisma/enums';

export interface ChargeRequest {
  chargeId: string;
  amountCents: number;
  currency: string;
  description: string;
  /** URL pública del webhook de esta cuenta. */
  notificationUrl: string;
  expiresAt: Date;
  /** Adónde vuelve el cliente al terminar de pagar (si la pasarela lo admite). */
  backUrl?: string;
  /** Firma para el checkout del simulador. */
  simulatorSig?: string;
}

/** Estado que da la pasarela: solo "pagado" cierra el cobro (un rechazo deja reintentar). */
export interface ProviderStatus {
  status: 'pending' | 'paid';
  paymentId: string | null;
  /** Detalle para auditoría (estado crudo, método…). */
  detail?: Record<string, unknown>;
}

/** Lo que un webhook (ya verificado) dice que hay que consultar. */
export interface WebhookHint {
  paymentId?: string;
  /** Id de nuestro cobro, solo si viene dentro de un mensaje firmado (Izipay). */
  chargeId?: string;
}

export interface WebhookInput {
  body: unknown;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

export interface ShopGateway<C = unknown> {
  readonly id: GatewayProvider;
  readonly name: string;
  /** Solo en desarrollo/pruebas (el simulador). */
  readonly devOnly: boolean;
  readonly credentials: z.ZodType<C>;
  /** Campos del formulario para conectar la cuenta. */
  readonly fields: Array<{
    key: string;
    label: string;
    required: boolean;
    secret: boolean;
    help: string | null;
  }>;
  /** Lo que se puede mostrar sin descifrar (nunca secretos completos). */
  publicInfo(c: C): Record<string, string>;
  modeOf(c: C): 'test' | 'live';
  /** Prueba las credenciales contra la pasarela. Devuelve el nombre de la cuenta si lo hay. */
  verify(c: C): Promise<{ account: string | null }>;
  createCharge(c: C, req: ChargeRequest): Promise<{ providerRef: string; checkoutUrl: string }>;
  /**
   * Estado autoritativo consultado a la pasarela. NUNCA se confía en el cuerpo de un webhook:
   * el webhook solo dice "algo cambió", y aquí se pregunta qué.
   */
  fetchStatus(
    c: C,
    charge: { id: string; amountCents: number; currency: string; providerRef: string | null },
    hint?: WebhookHint,
  ): Promise<ProviderStatus>;
  /**
   * Extrae del webhook el id a consultar y valida la firma (si la cuenta la configuró).
   * Devuelve null si el evento no interesa; lanza si la firma no es válida.
   */
  parseWebhook(c: C, input: WebhookInput): WebhookHint | null;
  /**
   * Devuelve un pago aprobado (total o parcial). `idempotencyKey` evita devolver dos veces si se
   * reintenta tras un error de red.
   */
  refund(
    c: C,
    req: { paymentId: string; amountCents: number; idempotencyKey: string },
  ): Promise<{ refundId: string }>;
  /** Con el id de un webhook, a qué cobro nuestro pertenece (null si no es nuestro). */
  resolveChargeId(c: C, hint: WebhookHint): Promise<string | null>;
}

export class GatewayHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class InvalidSignatureError extends Error {}
