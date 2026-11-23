import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IsoDate } from '../../common/http/zod';

const Int = z.number().int();
const NoticeKind = z.enum([
  'invoice_issued',
  'due_soon',
  'overdue',
  'final_warning',
  'suspended',
  'reactivated',
]);

export class CollectionsDto extends createZodDto(
  z.object({
    config: z.object({ renewalLeadDays: Int, reminderDays: Int, graceDays: Int }),
    kpis: z.object({
      mrrCents: Int,
      activeSubscriptions: Int,
      dueSoonCents: Int,
      dueSoonCount: Int,
      overdueCents: Int,
      overdueCount: Int,
      suspendedForBilling: Int,
      collectedMonthCents: Int,
      collectedMonthCount: Int,
    }),
    /** Barberías con facturas vencidas, de la más atrasada a la menos. */
    delinquent: z.array(
      z.object({
        barbershop: z.object({
          id: z.uuid(),
          name: z.string(),
          slug: z.string(),
          status: z.string(),
          suspendedReason: z.string().nullable(),
        }),
        plan: z.string(),
        subscriptionStatus: z.string(),
        invoices: Int,
        owedCents: Int,
        oldestDueAt: IsoDate,
        daysOverdue: Int,
        suspendsAt: IsoDate,
        lastNotice: z.object({ kind: NoticeKind, status: z.string(), at: IsoDate }).nullable(),
      }),
    ),
    notices: z.array(
      z.object({
        id: z.uuid(),
        kind: NoticeKind,
        channel: z.enum(['email', 'whatsapp']),
        status: z.string(),
        recipients: z.array(z.string()),
        error: z.string().nullable(),
        createdAt: IsoDate,
        sentAt: IsoDate.nullable(),
        barbershop: z.object({ id: z.uuid(), name: z.string() }),
        invoiceNumber: z.string(),
      }),
    ),
  }),
  { codec: true },
) {}

export class DunningRunDto extends createZodDto(
  z.object({
    invoicesIssued: Int,
    pastDue: Int,
    suspended: Int,
    noticesQueued: Int,
    noticesSent: Int,
    noticesFailed: Int,
  }),
) {}

// ───────────────────────── cambio de plan desde la barbería (paso 32) ─────────────────────────

const Limit = z.number().int().nullable();
export class PlanOptionsDto extends createZodDto(
  z.object({
    currentPlanCode: z.string(),
    interval: z.enum(['month', 'year']),
    status: z.enum(['trialing', 'active', 'past_due', 'suspended', 'canceled']),
    /** Solo en prueba o al día (morosa o suspendida: primero paga). */
    canChange: z.boolean(),
    pending: z
      .object({
        planCode: z.string(),
        planName: z.string(),
        interval: z.enum(['month', 'year']),
        effectiveAt: IsoDate,
      })
      .nullable(),
    usage: z.object({ staff: Int, locations: Int, services: Int }),
    plans: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        priceMonthlyCents: Int,
        priceYearlyCents: Int,
        currency: z.string(),
        limits: z.object({ staff: Limit, locations: Limit, services: Limit }),
        features: z.record(z.string(), z.boolean()),
        /** now: se aplica ya · scheduled: al fin del periodo · current: es el actual. */
        change: z.enum(['now', 'scheduled', 'current']),
        /** Factura por la diferencia si se sube ahora (0 = sin factura). */
        prorationCents: Int,
        /** Lo que sobra para bajar a este plan. */
        blockers: z.array(
          z.object({ key: z.enum(['staff', 'locations', 'services']), max: Int, current: Int }),
        ),
      }),
    ),
  }),
  { codec: true },
) {}

export const ChangePlanSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  interval: z.enum(['month', 'year']),
});
export class ShopChangePlanDto extends createZodDto(ChangePlanSchema) {}
export class ChangePlanResultDto extends createZodDto(
  z.object({
    result: z.enum(['changed', 'scheduled']),
    invoice: z.object({ id: z.uuid(), amountCents: Int }).nullable(),
  }),
) {}
