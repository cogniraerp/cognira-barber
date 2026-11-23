import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate, paginated, PaginationQuerySchema } from '../../common/http/zod';

const Provider = z.enum(['simulator', 'mercadopago', 'izipay']);
const Status = z.enum(['pending', 'paid', 'failed', 'expired', 'canceled']);
const money = z.number().int().min(100, 'Mínimo S/ 1.00').max(10_000_000);

export const ConnectGatewaySchema = z.object({
  provider: Provider,
  /** Credenciales según el proveedor (se validan con su esquema y se guardan cifradas). */
  credentials: z.record(z.string(), z.string()).default({}),
});
export class ConnectGatewayDto extends createZodDto(ConnectGatewaySchema) {}

export const UpdateGatewaySchema = z.object({
  credentials: z.record(z.string(), z.string()).optional(),
  isActive: z.boolean().optional(),
});
export class UpdateGatewayDto extends createZodDto(UpdateGatewaySchema) {}

const AccountSchema = z.object({
  id: z.uuid(),
  provider: Provider,
  providerName: z.string(),
  mode: z.enum(['test', 'live']),
  isActive: z.boolean(),
  status: z.enum(['unverified', 'ok', 'error']),
  lastError: z.string().nullable(),
  verifiedAt: IsoDate.nullable(),
  publicInfo: z.record(z.string(), z.string()),
  /** Pegar en el panel de la pasarela (notificaciones/webhooks). */
  webhookUrl: z.string(),
  createdAt: IsoDate,
});
export class GatewayAccountDto extends createZodDto(AccountSchema, { codec: true }) {}

export class GatewayOverviewDto extends createZodDto(
  z.object({
    /** El plan incluye pagos en línea. */
    enabled: z.boolean(),
    accounts: z.array(AccountSchema),
    providers: z.array(
      z.object({
        id: Provider,
        name: z.string(),
        devOnly: z.boolean(),
        fields: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            required: z.boolean(),
            secret: z.boolean(),
            help: z.string().nullable(),
          }),
        ),
      }),
    ),
  }),
  { codec: true },
) {}

export const CreateChargeSchema = z.object({
  amountCents: money,
  description: z.string().trim().min(3).max(120).optional(),
});
export class CreateChargeDto extends createZodDto(CreateChargeSchema) {}

export const ChargeSchema = z.object({
  id: z.uuid(),
  provider: Provider,
  amountCents: z.number().int(),
  currency: z.string(),
  description: z.string(),
  status: Status,
  checkoutUrl: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  expiresAt: IsoDate,
  paidAt: IsoDate.nullable(),
  sale: z.object({ id: z.uuid(), code: z.string() }).nullable(),
  createdAt: IsoDate,
});
export class ChargeDto extends createZodDto(ChargeSchema, { codec: true }) {}
export class ChargeListDto extends createZodDto(paginated(ChargeSchema), { codec: true }) {}

export const ChargesQuerySchema = PaginationQuerySchema.extend({ status: Status.optional() });
export class ChargesQueryDto extends createZodDto(ChargesQuerySchema) {}

// ───────────────────────── suscripción (pasarela de la plataforma) ─────────────────────────

export class ShopBillingDto extends createZodDto(
  z.object({
    subscription: z.object({
      status: z.enum(['trialing', 'active', 'past_due', 'suspended', 'canceled']),
      interval: z.enum(['month', 'year']),
      trialEndsAt: IsoDate.nullable(),
      currentPeriodEnd: IsoDate.nullable(),
      discountPercent: z.number().int(),
      plan: z.object({
        code: z.string(),
        name: z.string(),
        priceMonthlyCents: z.number().int(),
        priceYearlyCents: z.number().int(),
        currency: z.string(),
      }),
    }),
    invoices: z.array(
      z.object({
        id: z.uuid(),
        number: z.string(),
        status: z.enum(['draft', 'open', 'paid', 'void', 'failed']),
        amountCents: z.number().int(),
        currency: z.string(),
        periodStart: IsoDate,
        periodEnd: IsoDate,
        dueAt: IsoDate,
        paidAt: IsoDate.nullable(),
      }),
    ),
    /** La plataforma tiene una pasarela activa para pagar en línea. */
    onlinePay: z.boolean(),
  }),
  { codec: true },
) {}

export class InvoiceChargeDto extends createZodDto(
  z.object({
    id: z.uuid(),
    invoiceId: z.uuid(),
    provider: Provider,
    amountCents: z.number().int(),
    currency: z.string(),
    status: Status,
    checkoutUrl: z.string().nullable(),
    providerPaymentId: z.string().nullable(),
    expiresAt: IsoDate,
    paidAt: IsoDate.nullable(),
  }),
  { codec: true },
) {}

// ───────────────────────── devoluciones (paso 31) ─────────────────────────

const RefundStatus = z.enum(['pending', 'succeeded', 'failed']);
export const RefundSchema = z.object({
  id: z.uuid(),
  amountCents: z.number().int(),
  currency: z.string(),
  reason: z.string(),
  status: RefundStatus,
  description: z.string(),
  providerPaymentId: z.string().nullable(),
  providerRefundId: z.string().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  saleCode: z.string().nullable(),
  createdAt: IsoDate,
  completedAt: IsoDate.nullable(),
});
export class RefundDto extends createZodDto(RefundSchema, { codec: true }) {}
export class RefundListDto extends createZodDto(paginated(RefundSchema), { codec: true }) {}
export const RefundsQuerySchema = PaginationQuerySchema.extend({ status: RefundStatus.optional() });
export class RefundsQueryDto extends createZodDto(RefundsQuerySchema) {}
