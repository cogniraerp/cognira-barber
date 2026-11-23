import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../../common/auth/auth.types';
import { OptionalAuth, Public } from '../../common/auth/decorators';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { RequestContext } from '../../common/request-context/request-context';
import { fromDbTime, sortBlocks } from '../../common/time/time-blocks';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../../common/audit/audit.service';
import { badRequest } from '../shop/shop-helpers';
import {
  readableOn,
  readBookingRules,
  readBranding,
  type BookingRules,
} from '../shop/settings.schemas';
import { AvailabilityDto } from './appointments.dto';
import { applyStatus, groupByDay } from './shop-appointments.controller';
import { BookingService, resolveCustomer } from './booking.service';
import { buildIcs } from './ics';
import { ManageTokenService } from '../../common/crypto/manage-token';
import {
  PublicAppointmentDto,
  PublicAvailabilityQueryDto,
  PublicBookDto,
  PublicCancelDto,
  PublicRescheduleDto,
  PublicShopDto,
} from './public-booking.dto';
import { CurrentUserOptional } from './current-user-optional';
import { NotificationsService } from '../notifications/notifications.service';
import { ChargesService, releaseHold } from '../payments/charges.service';

const asList = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
const bookingLimit = () => Number(process.env.PUBLIC_BOOKINGS_PER_HOUR ?? 10);

/**
 * Página pública de reservas (sin login; el login del cliente es opcional).
 * La barbería se resuelve por slug en contexto 'system' y TODO lo demás corre con el
 * contexto del tenant, así que la RLS acota cada consulta a esa barbería.
 */
@ApiTags('público · reservas')
@Controller('public')
export class PublicBookingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly booking: BookingService,
    private readonly tokens: ManageTokenService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly charges: ChargesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('shops/:slug')
  @Public()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ZodResponse({ type: PublicShopDto })
  async shop(@Param('slug') slug: string) {
    const shopId = await this.resolve(slug);
    return this.prisma.run(db(shopId), async (tx) => {
      const [shop, settings, locations, hours, categories, services, staff, gallery] =
        await Promise.all([
          tx.barbershop.findUniqueOrThrow({
            where: { id: shopId },
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              phone: true,
              timezone: true,
              currency: true,
              branding: true,
            },
          }),
          tx.barbershopSettings.findUnique({
            where: { barbershopId: shopId },
            select: { bookingRules: true },
          }),
          tx.location.findMany({
            where: { barbershopId: shopId, deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          }),
          tx.businessHour.findMany({ where: { barbershopId: shopId, deletedAt: null } }),
          tx.serviceCategory.findMany({
            where: { barbershopId: shopId, deletedAt: null },
            select: { id: true, name: true },
            orderBy: { sortOrder: 'asc' },
          }),
          tx.service.findMany({
            where: {
              barbershopId: shopId,
              deletedAt: null,
              isActive: true,
              isOnlineBookable: true,
            },
            select: {
              id: true,
              name: true,
              description: true,
              imageUrl: true,
              categoryId: true,
              durationMin: true,
              priceCents: true,
              staffServices: {
                where: { staff: { isActive: true, deletedAt: null } },
                select: { staffId: true, priceCentsOverride: true },
              },
            },
            orderBy: { sortOrder: 'asc' },
          }),
          tx.staff.findMany({
            where: {
              barbershopId: shopId,
              deletedAt: null,
              isActive: true,
              services: {
                some: { service: { isActive: true, isOnlineBookable: true, deletedAt: null } },
              },
            },
            select: { id: true, displayName: true, bio: true, photoUrl: true, specialties: true },
            orderBy: { sortOrder: 'asc' },
          }),
          tx.galleryImage.findMany({
            where: { barbershopId: shopId, deletedAt: null, isVisible: true },
            select: { url: true, caption: true },
            orderBy: { sortOrder: 'asc' },
          }),
        ]);
      const rules = readBookingRules(settings?.bookingRules);
      const b = readBranding(shop.branding);
      return {
        ...shop,
        branding: {
          ...b,
          primaryForeground: readableOn(b.primaryColor),
          secondaryForeground: readableOn(b.secondaryColor),
          socials: { ...b.socials },
        },
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          reference: l.reference,
          lat: l.lat,
          lng: l.lng,
          isPrimary: l.isPrimary,
          hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d,
            blocks: sortBlocks(
              hours
                .filter((h) => h.locationId === l.id && h.dayOfWeek === d)
                .map((h) => ({ start: fromDbTime(h.opensAt), end: fromDbTime(h.closesAt) })),
            ),
          })),
        })),
        categories,
        services: services
          .filter((s) => s.staffServices.length)
          .map(({ staffServices, priceCents, ...s }) => {
            const prices = staffServices.map((x) => x.priceCentsOverride ?? priceCents);
            return {
              ...s,
              priceFromCents: Math.min(...prices),
              priceToCents: Math.max(...prices),
              staffIds: staffServices.map((x) => x.staffId),
            };
          }),
        staff,
        gallery,
        booking: {
          allowStaffSelection: rules.allowStaffSelection,
          allowAnyStaff: rules.allowAnyStaff,
          minNoticeMinutes: rules.minNoticeMinutes,
          maxAdvanceDays: rules.maxAdvanceDays,
          cancellationWindowHours: rules.cancellationWindowHours,
          approvalMode: rules.approvalMode,
          requiredFields: rules.requiredFields,
          customFields: rules.customFields,
        },
      };
    });
  }

  @Get('shops/:slug/availability')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ZodResponse({ type: AvailabilityDto })
  async shopAvailability(@Param('slug') slug: string, @Query() q: PublicAvailabilityQueryDto) {
    const shopId = await this.resolve(slug);
    return this.prisma.run(db(shopId), async (tx) => {
      const rules = await rulesOf(tx, shopId);
      assertStaffChoice(rules, q.staffId ?? null);
      const r = await this.availability.compute(tx, {
        barbershopId: shopId,
        serviceIds: asList(q.serviceIds),
        staffId: q.staffId,
        from: q.from,
        to: q.to,
        slotIntervalMinutes: rules.slotIntervalMinutes,
        minNoticeMinutes: rules.minNoticeMinutes,
        maxAdvanceDays: rules.maxAdvanceDays,
        onlineOnly: true,
      });
      return groupByDay(r.slots, r.timezone, rules.allowStaffSelection, [...r.quotes.values()]);
    });
  }

  /** Reservar. Si el cliente inició sesión, su ficha de cliente queda vinculada a su cuenta. */
  @Post('shops/:slug/appointments')
  @OptionalAuth()
  @Throttle({ default: { limit: bookingLimit, ttl: 3_600_000 } })
  @ZodResponse({ type: PublicAppointmentDto, status: 201 })
  async book(
    @Param('slug') slug: string,
    @Body() dto: PublicBookDto,
    @CurrentUserOptional() user?: AuthUser,
  ) {
    const shopId = await this.resolve(slug);
    const { rules, customerId, history } = await this.prisma.run(db(shopId), async (tx) => {
      const rules = await rulesOf(tx, shopId);
      assertStaffChoice(rules, dto.staffId);
      validateCustomerFields(rules, dto);
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: shopId },
        select: { country: true },
      });
      const phone = rules.requiredFields.phone === 'hidden' ? null : dto.customer.phone;
      const email = rules.requiredFields.email === 'hidden' ? null : dto.customer.email;
      const customer = await resolveCustomer(
        tx,
        shopId,
        { fullName: dto.customer.fullName, phone, email },
        shop.country,
        user?.userId,
      );
      if (customer.isBlocked) {
        throw AppError.forbidden('No es posible reservar en línea. Comunícate con la barbería.');
      }
      const active = await tx.appointment.count({
        where: {
          barbershopId: shopId,
          customerId: customer.id,
          deletedAt: null,
          status: { in: ['awaiting_payment', 'pending', 'confirmed'] },
          startAt: { gt: new Date() },
        },
      });
      if (active >= rules.maxActiveBookingsPerCustomer) {
        throw AppError.conflict(
          `Ya tienes ${active} reserva(s) activa(s); el máximo es ${rules.maxActiveBookingsPerCustomer}`,
        );
      }
      // Historial para la regla "solo nuevos o que faltaron".
      const [completedVisits, noShows] = await Promise.all([
        tx.appointment.count({
          where: {
            barbershopId: shopId,
            customerId: customer.id,
            status: 'completed',
            deletedAt: null,
          },
        }),
        tx.appointment.count({
          where: {
            barbershopId: shopId,
            customerId: customer.id,
            status: 'no_show',
            deletedAt: null,
          },
        }),
      ]);
      return { rules, customerId: customer.id, history: { completedVisits, noShows } };
    });
    // Adelanto: solo si la barbería tiene pagos en línea activos; si no, se reserva como siempre.
    const depositsOn = await this.charges.depositsEnabled(shopId);

    const input = {
      db: db(shopId),
      barbershopId: shopId,
      serviceIds: dto.serviceIds,
      staffId: dto.staffId,
      startAt: new Date(dto.startAt),
      customerId,
      source: 'online' as const,
      status: rules.approvalMode === 'manual' ? ('pending' as const) : ('confirmed' as const),
      customerNotes: dto.notes ?? null,
      customFields: dto.customFields,
      enforceSchedule: true,
      rules: {
        slotIntervalMinutes: rules.slotIntervalMinutes,
        minNoticeMinutes: rules.minNoticeMinutes,
        maxAdvanceDays: rules.maxAdvanceDays,
      },
      onlineOnly: true,
      deposit: depositsOn ? { rule: rules.deposit, customer: history } : undefined,
    };
    let id: string;
    let deposit: { id: string } | null;
    try {
      ({ id, deposit } = await this.booking.bookWithDeposit(input));
    } catch (e) {
      if (e instanceof AppError && e.code === ErrorCode.SLOT_TAKEN) {
        const alternatives = await this.booking.alternatives(input, input.startAt);
        throw new AppError(e.code, e.status, e.message, {
          alternatives: alternatives.map((d) => d.toISOString()),
        });
      }
      throw e;
    }
    await this.prisma.run(db(shopId), (tx) =>
      this.audit.record(tx, {
        action: 'public.appointment.create',
        barbershopId: shopId,
        entity: 'appointment',
        entityId: id,
      }),
    );
    const token = this.tokens.sign(id);
    if (deposit)
      await this.charges.createForDeposit(
        shopId,
        deposit.id,
        this.manageUrl(slug.trim().toLowerCase(), token),
      );
    return this.view(token);
  }

  @Get('appointments/:token')
  @Public()
  @ZodResponse({ type: PublicAppointmentDto })
  view(@Param('token') token: string) {
    return this.withAppointment(token, async (tx, a, rules) => this.toPublic(tx, a, rules, token));
  }

  @Post('appointments/:token/cancel')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ZodResponse({ type: PublicAppointmentDto })
  async cancel(@Param('token') token: string, @Body() dto: PublicCancelDto) {
    await this.withAppointment(token, async (tx, a, rules) => {
      // Reserva apartada sin pagar: el cliente desiste y el horario se libera (no hubo aviso).
      if (a.status === 'awaiting_payment') {
        const dep = await tx.appointmentDeposit.findUnique({
          where: { appointmentId: a.id },
          select: { id: true },
        });
        if (dep)
          await releaseHold(tx, dep.id, dto.reason ?? 'Cancelada por el cliente antes de pagar');
        return;
      }
      if (!canChange(a, rules)) throw tooLate(rules);
      await applyStatus(
        tx,
        a.id,
        a.status,
        'canceled',
        dto.reason ?? 'Cancelada por el cliente',
        a.customerId,
      );
      await this.notifications.onAppointment(tx, 'canceled', a.id);
      await this.audit.record(tx, {
        action: 'public.appointment.cancel',
        barbershopId: a.barbershopId,
        entity: 'appointment',
        entityId: a.id,
        diff: { reason: dto.reason },
      });
    });
    return this.view(token);
  }

  /** "Ya pagué": consulta a la pasarela el estado del adelanto (los webhooks no llegan en local). */
  @Post('appointments/:token/deposit/check')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @ZodResponse({ type: PublicAppointmentDto })
  async checkDeposit(@Param('token') token: string) {
    const dep = await this.withAppointment(token, (tx, a) =>
      tx.appointmentDeposit.findUnique({
        where: { appointmentId: a.id },
        select: { barbershopId: true, chargeId: true, status: true },
      }),
    );
    if (dep?.chargeId && dep.status === 'pending')
      await this.charges.refreshSystem(dep.barbershopId, dep.chargeId).catch(() => undefined);
    return this.view(token);
  }

  @Post('appointments/:token/reschedule')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ZodResponse({ type: PublicAppointmentDto })
  async reschedule(@Param('token') token: string, @Body() dto: PublicRescheduleDto) {
    const { a, rules } = await this.withAppointment(token, (_tx, a, rules) => {
      if (!canChange(a, rules)) throw tooLate(rules);
      if (dto.staffId !== undefined) assertStaffChoice(rules, dto.staffId);
      return Promise.resolve({ a, rules });
    });
    const input = {
      db: db(a.barbershopId),
      barbershopId: a.barbershopId,
      appointmentId: a.id,
      staffId: dto.staffId ?? null,
      startAt: new Date(dto.startAt),
      enforceSchedule: true,
      onlineOnly: true,
      rules: {
        slotIntervalMinutes: rules.slotIntervalMinutes,
        minNoticeMinutes: rules.minNoticeMinutes,
        maxAdvanceDays: rules.maxAdvanceDays,
      },
    };
    try {
      await this.booking.reschedule(input);
    } catch (e) {
      if (e instanceof AppError && e.code === ErrorCode.SLOT_TAKEN) {
        const serviceIds = await this.prisma.run(db(a.barbershopId), async (tx) =>
          (
            await tx.appointmentService.findMany({
              where: { appointmentId: a.id },
              select: { serviceId: true },
              orderBy: { sortOrder: 'asc' },
            })
          ).map((s) => s.serviceId),
        );
        const alternatives = await this.booking.alternatives(
          { ...input, serviceIds, staffId: dto.staffId ?? a.staffId },
          input.startAt,
        );
        throw new AppError(e.code, e.status, e.message, {
          alternatives: alternatives.map((d) => d.toISOString()),
        });
      }
      throw e;
    }
    await this.prisma.run(db(a.barbershopId), (tx) =>
      this.audit.record(tx, {
        action: 'public.appointment.reschedule',
        barbershopId: a.barbershopId,
        entity: 'appointment',
        entityId: a.id,
        diff: { from: a.startAt.toISOString(), to: dto.startAt },
      }),
    );
    return this.view(token);
  }

  @Get('appointments/:token/ics')
  @Public()
  @ApiProduces('text/calendar')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cita.ics"')
  ics(@Param('token') token: string): Promise<string> {
    return this.withAppointment(token, async (tx, a) => {
      const [shop, loc, items] = await Promise.all([
        tx.barbershop.findUniqueOrThrow({
          where: { id: a.barbershopId },
          select: { name: true, slug: true },
        }),
        tx.location.findUnique({ where: { id: a.locationId }, select: { address: true } }),
        tx.appointmentService.findMany({
          where: { appointmentId: a.id },
          select: { nameSnapshot: true },
          orderBy: { sortOrder: 'asc' },
        }),
      ]);
      return buildIcs({
        uid: `${a.id}@barbersaas`,
        start: a.startAt,
        end: a.endAt,
        summary: `${items.map((i) => i.nameSnapshot).join(' + ')} · ${shop.name}`,
        location: loc?.address ?? undefined,
        url: this.manageUrl(shop.slug, token),
      });
    });
  }

  // ─────────────────────────── internos ───────────────────────────

  private async resolve(slug: string): Promise<string> {
    const normalized = slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,48}$/.test(normalized)) throw notFound();
    const shop = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.barbershop.findFirst({
        where: { slug: normalized, status: 'active', deletedAt: null },
        select: { id: true },
      }),
    );
    if (!shop) throw notFound();
    return shop.id;
  }

  private async withAppointment<T>(
    token: string,
    fn: (tx: Tx, a: ApptRow, rules: BookingRules) => Promise<T>,
  ): Promise<T> {
    const id = this.tokens.verify(token);
    if (!id) throw AppError.notFound('Cita');
    const found = await this.prisma.run({ kind: 'system' }, (tx) =>
      tx.appointment.findFirst({
        where: { id, deletedAt: null, barbershop: { deletedAt: null } },
        select: { barbershopId: true },
      }),
    );
    if (!found) throw AppError.notFound('Cita');
    return this.prisma.run(db(found.barbershopId), async (tx) => {
      const a = await tx.appointment.findUniqueOrThrow({ where: { id }, select: apptSelect });
      return fn(tx, a, await rulesOf(tx, a.barbershopId));
    });
  }

  private async toPublic(tx: Tx, a: ApptRow, rules: BookingRules, token: string) {
    const [shop, loc, staff, items, customer] = await Promise.all([
      tx.barbershop.findUniqueOrThrow({
        where: { id: a.barbershopId },
        select: { name: true, slug: true, phone: true, timezone: true },
      }),
      tx.location.findUnique({
        where: { id: a.locationId },
        select: { address: true, timezone: true },
      }),
      tx.staff.findUniqueOrThrow({
        where: { id: a.staffId },
        select: { id: true, displayName: true },
      }),
      tx.appointmentService.findMany({
        where: { appointmentId: a.id },
        select: { serviceId: true, nameSnapshot: true, priceCents: true, durationMin: true },
        orderBy: { sortOrder: 'asc' },
      }),
      a.customerId
        ? tx.customer.findUnique({ where: { id: a.customerId }, select: { fullName: true } })
        : null,
    ]);
    const changeable = canChange(a, rules);
    return {
      id: a.id,
      status: a.status,
      startAt: a.startAt,
      endAt: a.endAt,
      timezone: loc?.timezone ?? shop.timezone,
      shop: { name: shop.name, slug: shop.slug, phone: shop.phone, address: loc?.address ?? null },
      staff,
      services: items.map((i) => ({
        id: i.serviceId,
        name: i.nameSnapshot,
        priceCents: i.priceCents,
        durationMin: i.durationMin,
      })),
      totalCents: a.totalCents,
      currency: a.currency,
      customerName: customer?.fullName.split(' ')[0] ?? null,
      canCancel: changeable,
      canReschedule: changeable,
      changeDeadline: deadline(a, rules),
      manageToken: token,
      manageUrl: this.manageUrl(shop.slug, token),
      deposit: await depositView(tx, a.id),
      icsUrl: `${this.env.PUBLIC_API_URL.replace(/\/$/, '')}/v1/public/appointments/${token}/ics`,
    };
  }

  private manageUrl(slug: string, token: string): string {
    return `${this.env.WEB_URL.replace(/\/$/, '')}/b/${slug}/cita/${token}`;
  }
}

const apptSelect = {
  id: true,
  barbershopId: true,
  locationId: true,
  staffId: true,
  customerId: true,
  status: true,
  startAt: true,
  endAt: true,
  totalCents: true,
  currency: true,
} as const;
type ApptRow = {
  id: string;
  barbershopId: string;
  locationId: string;
  staffId: string;
  customerId: string | null;
  status:
    | 'awaiting_payment'
    | 'pending'
    | 'confirmed'
    | 'in_progress'
    | 'completed'
    | 'no_show'
    | 'canceled';
  startAt: Date;
  endAt: Date;
  totalCents: number;
  currency: string;
};

const db = (barbershopId: string): DbContext => ({
  kind: 'tenant',
  barbershopId,
  userId: RequestContext.get()?.userId ?? null,
});

async function rulesOf(tx: Tx, barbershopId: string): Promise<BookingRules> {
  const s = await tx.barbershopSettings.findUnique({
    where: { barbershopId },
    select: { bookingRules: true },
  });
  return readBookingRules(s?.bookingRules);
}

function deadline(a: ApptRow, rules: BookingRules): Date {
  return new Date(a.startAt.getTime() - rules.cancellationWindowHours * 3_600_000);
}

async function depositView(tx: Tx, appointmentId: string) {
  const d = await tx.appointmentDeposit.findUnique({
    where: { appointmentId },
    select: {
      amountCents: true,
      status: true,
      holdExpiresAt: true,
      charge: { select: { status: true, checkoutUrl: true } },
    },
  });
  if (!d) return null;
  return {
    amountCents: d.amountCents,
    status: d.status,
    payUrl: d.status === 'pending' && d.charge?.status === 'pending' ? d.charge.checkoutUrl : null,
    holdExpiresAt: d.holdExpiresAt,
  };
}

function canChange(a: ApptRow, rules: BookingRules): boolean {
  return ['pending', 'confirmed'].includes(a.status) && Date.now() <= deadline(a, rules).getTime();
}

function tooLate(rules: BookingRules): AppError {
  return AppError.conflict(
    rules.cancellationWindowHours > 0
      ? `Solo se puede cambiar hasta ${rules.cancellationWindowHours} h antes. Comunícate con la barbería.`
      : 'Esta cita ya no se puede cambiar en línea',
  );
}

function assertStaffChoice(rules: BookingRules, staffId: string | null): void {
  if (staffId && !rules.allowStaffSelection)
    throw badRequest('staffId', 'Esta barbería asigna el barbero automáticamente');
  if (!staffId && !rules.allowAnyStaff) throw badRequest('staffId', 'Elige un barbero');
}

/** Datos requeridos y campos personalizados según la configuración de la barbería. */
function validateCustomerFields(rules: BookingRules, dto: PublicBookDto): void {
  const { phone, email } = rules.requiredFields;
  if (phone === 'required' && !dto.customer.phone)
    throw badRequest('customer.phone', 'El teléfono es obligatorio');
  if (email === 'required' && !dto.customer.email)
    throw badRequest('customer.email', 'El email es obligatorio');
  if (phone === 'hidden' && email === 'hidden') return;
  if (!(phone !== 'hidden' && dto.customer.phone) && !(email !== 'hidden' && dto.customer.email)) {
    throw badRequest('customer.phone', 'Indica un teléfono o un email para contactarte');
  }
  const known = new Set(rules.customFields.map((f) => f.key));
  for (const key of Object.keys(dto.customFields)) {
    if (!known.has(key)) throw badRequest(`customFields.${key}`, 'Campo desconocido');
  }
  for (const f of rules.customFields) {
    const v = dto.customFields[f.key];
    const empty = v === undefined || v === '' || v === false;
    if (f.required && empty)
      throw badRequest(`customFields.${f.key}`, `"${f.label}" es obligatorio`);
    if (empty) continue;
    if (f.type === 'checkbox' && typeof v !== 'boolean')
      throw badRequest(`customFields.${f.key}`, 'Debe ser sí/no');
    if (f.type !== 'checkbox' && typeof v !== 'string')
      throw badRequest(`customFields.${f.key}`, 'Debe ser texto');
    if (f.type === 'select' && !f.options?.includes(v as string))
      throw badRequest(`customFields.${f.key}`, 'Opción inválida');
  }
}

function notFound(): AppError {
  return new AppError(ErrorCode.TENANT_NOT_FOUND, HttpStatus.NOT_FOUND, 'Barbería no encontrada');
}
