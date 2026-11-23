import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Method } from '../cash/cash.dto';

export const MAX_REPORT_DAYS = 366;

export const ReportQuerySchema = z.object({
  /** Fechas locales de la barbería (YYYY-MM-DD), ambas incluidas. Máx. 366 días. */
  from: z.iso.date(),
  to: z.iso.date(),
  locationId: z.uuid().optional(),
});
export class ReportQueryDto extends createZodDto(ReportQuerySchema) {}

export const REPORT_SECTIONS = ['days', 'staff', 'services', 'products', 'methods'] as const;
export class ReportExportQueryDto extends createZodDto(
  ReportQuerySchema.extend({ section: z.enum(REPORT_SECTIONS) }),
) {}

const Int = z.number().int();

const KpisSchema = z.object({
  /** Total cobrado − propinas. */
  revenueCents: Int,
  salesCount: Int,
  avgTicketCents: Int,
  tipCents: Int,
  discountCents: Int,
  serviceCents: Int,
  productCents: Int,
  servicesCount: Int,
  productsCount: Int,
  /** Citas del período sin contar las canceladas. */
  appointments: Int,
  completed: Int,
  noShows: Int,
  canceled: Int,
  /** Minutos reservados (citas no canceladas) y minutos de trabajo programados. */
  bookedMin: Int,
  scheduledMin: Int,
  /** Clientes atendidos (con venta o cita completada); nuevos = su primera visita cae en el período. */
  customers: Int,
  newCustomers: Int,
  returningCustomers: Int,
});

const CatalogRow = z.object({
  id: z.uuid().nullable(),
  name: z.string(),
  quantity: Int,
  revenueCents: Int,
});

export class ReportOverviewDto extends createZodDto(
  z.object({
    timezone: z.string(),
    period: z.object({ from: z.iso.date(), to: z.iso.date(), days: Int }),
    previous: z.object({ from: z.iso.date(), to: z.iso.date() }),
    kpis: KpisSchema,
    previousKpis: KpisSchema,
    byDay: z.array(
      z.object({ date: z.iso.date(), revenueCents: Int, salesCount: Int, tipCents: Int }),
    ),
    byStaff: z.array(
      z.object({
        staff: z.object({ id: z.uuid(), displayName: z.string() }),
        revenueCents: Int,
        serviceCents: Int,
        productCents: Int,
        servicesCount: Int,
        productsCount: Int,
        tipCents: Int,
        appointments: Int,
        completed: Int,
        noShows: Int,
        bookedMin: Int,
        scheduledMin: Int,
      }),
    ),
    byService: z.array(CatalogRow),
    byProduct: z.array(CatalogRow),
    byMethod: z.array(z.object({ method: Method, count: Int, amountCents: Int })),
    /** Adelantos cobrados en el período: aplicados en caja, por usar (cita futura), retenidos por inasistencia y por devolver. */
    deposits: z.object({
      count: Int,
      paidCents: Int,
      appliedCents: Int,
      unusedCents: Int,
      retainedCents: Int,
      refundPendingCents: Int,
      refundedCents: Int,
    }),
  }),
) {}
