import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const n = z.number().int();
const Money = z.object({ currency: z.string(), amountCents: n });

export const PlatformDashboardSchema = z.object({
  generatedAt: z.iso.datetime(),
  barbershops: z.object({ total: n, onboarding: n, active: n, suspended: n, deleted: n }),
  subscriptions: z.object({ trialing: n, active: n, past_due: n, suspended: n, canceled: n }),
  /** Ingreso recurrente mensual de suscripciones activas (anuales prorrateadas /12, con descuento). Una fila por moneda. */
  mrr: z.array(Money),
  arr: z.array(Money),
  churn30d: z.object({ canceled: n, rate: z.number().describe('0–1') }),
  trialConversion90d: z.object({ started: n, converted: n, rate: z.number() }),
  signups30d: z.array(z.object({ date: z.iso.date(), count: n })),
  appointments30d: n,
  whatsappThisMonth: n,
  topBarbershops: z.array(
    z.object({ id: z.uuid(), slug: z.string(), name: z.string(), appointments30d: n }),
  ),
});
export class PlatformDashboardDto extends createZodDto(PlatformDashboardSchema) {}
