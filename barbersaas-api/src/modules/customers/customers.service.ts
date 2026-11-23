import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { normalizeHeader, parseCsv, toCsv } from '../../common/http/csv';
import { pageArgs } from '../../common/http/zod';
import { can, tenantDb, type TenantContext } from '../../common/tenancy/tenant.types';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { StorageProvider } from '../../infra/storage/storage.provider';
import { maskEmail, maskPhone } from '../appointments/appointment-view';
import { normalizePhone } from '../appointments/phone';
import { utcToLocalDate } from '../availability/engine';
import { assertOwnFile } from '../shop/own-file';
import { ACTIVE_APPOINTMENT, badRequest } from '../shop/shop-helpers';
import type { CreateCustomerDto, ListCustomersQueryDto, UpdateCustomerDto } from './customers.dto';

const customerSelect = {
  id: true,
  fullName: true,
  phoneE164: true,
  email: true,
  birthday: true,
  tags: true,
  isBlocked: true,
  waOptIn: true,
  noShowCount: true,
  userId: true,
  lastVisitAt: true,
  createdAt: true,
} as const satisfies Prisma.CustomerSelect;
type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>;

const MAX_IMPORT_ROWS = 5000;
const HEADERS: Record<'name' | 'phone' | 'email' | 'birthday' | 'tags' | 'notes', string[]> = {
  name: ['nombre', 'name', 'nombrecompleto', 'cliente', 'fullname', 'nombres'],
  phone: ['telefono', 'phone', 'celular', 'movil', 'whatsapp', 'tel'],
  email: ['email', 'correo', 'correoelectronico', 'mail'],
  birthday: ['cumpleanos', 'birthday', 'fechadenacimiento', 'nacimiento'],
  tags: ['etiquetas', 'tags', 'etiqueta'],
  notes: ['notas', 'notes', 'nota', 'observaciones'],
};

class DryRunRollback extends Error {
  constructor(readonly result: unknown) {
    super('dry-run');
  }
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageProvider,
  ) {}

  // ─────────────── Consulta ───────────────
  async list(t: TenantContext, q: ListCustomersQueryDto) {
    const where = this.where(t, q);
    const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
      q.sort === '-createdAt'
        ? [{ createdAt: 'desc' }]
        : q.sort === '-lastVisitAt'
          ? [{ lastVisitAt: { sort: 'desc', nulls: 'last' } }]
          : [{ fullName: 'asc' }];
    return this.prisma.run(tenantDb(t), async (tx) => {
      const [rows, total] = await Promise.all([
        tx.customer.findMany({
          where,
          select: customerSelect,
          orderBy: [...orderBy, { id: 'asc' }],
          ...pageArgs(q),
        }),
        tx.customer.count({ where }),
      ]);
      const stats = await statsFor(
        tx,
        t.barbershopId,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => this.toDto(t, r, stats)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const c = await this.find(tx, t, id);
      return this.toDto(t, c, await statsFor(tx, t.barbershopId, [id]));
    });
  }

  history(t: TenantContext, id: string, page: { page: number; pageSize: number }) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const where: Prisma.AppointmentWhereInput = {
        barbershopId: t.barbershopId,
        customerId: id,
        deletedAt: null,
        // Un barbero solo ve en el historial lo que hizo él.
        ...(can(t, 'appointments.view_all')
          ? {}
          : { staffId: t.staffId ?? '00000000-0000-0000-0000-000000000000' }),
      };
      const [rows, total] = await Promise.all([
        tx.appointment.findMany({
          where,
          select: {
            id: true,
            startAt: true,
            status: true,
            totalCents: true,
            staff: { select: { id: true, displayName: true } },
            items: { select: { nameSnapshot: true }, orderBy: { sortOrder: 'asc' } },
          },
          orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
          ...pageArgs(page),
        }),
        tx.appointment.count({ where }),
      ]);
      return {
        items: rows.map(({ items, ...a }) => ({
          ...a,
          services: items.map((i) => i.nameSnapshot),
        })),
        total,
        ...page,
      };
    });
  }

  tags(t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const rows = await tx.$queryRaw<Array<{ tag: string; count: number }>>`
        SELECT tag, count(*)::int AS count
        FROM customers, unnest(tags) AS tag
        WHERE barbershop_id = ${t.barbershopId}::uuid AND deleted_at IS NULL
        GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 200`;
      return rows;
    });
  }

  // ─────────────── Altas y cambios ───────────────
  create(t: TenantContext, dto: CreateCustomerDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const phoneE164 = await this.checkPhone(tx, t, dto.phone);
      const c = await tx.customer.create({
        data: {
          barbershopId: t.barbershopId,
          fullName: dto.fullName,
          phoneE164,
          email: dto.email?.toLowerCase() ?? null,
          birthday: dto.birthday ? new Date(`${dto.birthday}T00:00:00Z`) : null,
          tags: uniq(dto.tags),
          waOptIn: dto.waOptIn,
        },
        select: customerSelect,
      });
      return this.toDto(t, c, await statsFor(tx, t.barbershopId, [c.id]));
    });
  }

  update(t: TenantContext, id: string, dto: UpdateCustomerDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const data: Prisma.CustomerUpdateInput = {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.toLowerCase() ?? null } : {}),
        ...(dto.birthday !== undefined
          ? { birthday: dto.birthday ? new Date(`${dto.birthday}T00:00:00Z`) : null }
          : {}),
        ...(dto.tags !== undefined ? { tags: uniq(dto.tags) } : {}),
        ...(dto.waOptIn !== undefined ? { waOptIn: dto.waOptIn } : {}),
        ...(dto.phone !== undefined
          ? { phoneE164: await this.checkPhone(tx, t, dto.phone, id) }
          : {}),
      };
      const c = await tx.customer.update({ where: { id }, data, select: customerSelect });
      return this.toDto(t, c, await statsFor(tx, t.barbershopId, [id]));
    });
  }

  setBlocked(t: TenantContext, id: string, blocked: boolean, reason?: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const c = await tx.customer.update({
        where: { id },
        data: { isBlocked: blocked },
        select: customerSelect,
      });
      await this.audit.record(tx, {
        action: blocked ? 'shop.customer.block' : 'shop.customer.unblock',
        barbershopId: t.barbershopId,
        entity: 'customer',
        entityId: id,
        diff: { reason },
      });
      return this.toDto(t, c, await statsFor(tx, t.barbershopId, [id]));
    });
  }

  remove(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const future = await tx.appointment.count({
        where: {
          barbershopId: t.barbershopId,
          customerId: id,
          deletedAt: null,
          status: ACTIVE_APPOINTMENT,
          startAt: { gt: new Date() },
        },
      });
      if (future)
        throw AppError.conflict(
          `El cliente tiene ${future} cita(s) futura(s)`,
          ErrorCode.CONFLICT,
          { futureAppointments: future },
        );
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'shop.customer.delete',
        barbershopId: t.barbershopId,
        entity: 'customer',
        entityId: id,
      });
    });
  }

  /**
   * Fusiona `sourceId` dentro de `targetId` (duplicados: mismo cliente con dos teléfonos, etc.).
   * Mueve citas, notas y mensajes; completa datos faltantes; une etiquetas; suma inasistencias.
   */
  merge(t: TenantContext, targetId: string, sourceId: string) {
    if (targetId === sourceId)
      throw badRequest('sourceId', 'No se puede fusionar un cliente consigo mismo');
    return this.prisma.run(tenantDb(t), async (tx) => {
      const target = await this.find(tx, t, targetId);
      const source = await this.find(tx, t, sourceId);
      const where = { barbershopId: t.barbershopId, customerId: sourceId };
      const [appts] = await Promise.all([
        tx.appointment.updateMany({ where, data: { customerId: targetId } }),
        tx.customerNote.updateMany({ where, data: { customerId: targetId } }),
        tx.messageLog.updateMany({ where, data: { customerId: targetId } }),
      ]);
      // El teléfono es único: se libera en el origen antes de pasarlo al destino.
      await tx.customer.update({
        where: { id: sourceId },
        data: { deletedAt: new Date(), phoneE164: null },
      });
      const lastVisitAt =
        [target.lastVisitAt, source.lastVisitAt]
          .filter(Boolean)
          .sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      const merged = await tx.customer.update({
        where: { id: targetId },
        data: {
          phoneE164: target.phoneE164 ?? source.phoneE164,
          email: target.email ?? source.email,
          birthday: target.birthday ?? source.birthday,
          tags: uniq([...target.tags, ...source.tags]),
          noShowCount: target.noShowCount + source.noShowCount,
          isBlocked: target.isBlocked || source.isBlocked,
          lastVisitAt,
          ...(target.userId || !source.userId ? {} : { user: { connect: { id: source.userId } } }),
        },
        select: customerSelect,
      });
      await this.audit.record(tx, {
        action: 'shop.customer.merge',
        barbershopId: t.barbershopId,
        entity: 'customer',
        entityId: targetId,
        diff: { sourceId, movedAppointments: appts.count },
      });
      return this.toDto(t, merged, await statsFor(tx, t.barbershopId, [targetId]));
    });
  }

  // ─────────────── Notas ───────────────
  notes(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const rows = await tx.customerNote.findMany({
        where: { barbershopId: t.barbershopId, customerId: id, deletedAt: null },
        select: {
          id: true,
          body: true,
          imageUrl: true,
          createdAt: true,
          authorMembershipId: true,
          author: { select: { user: { select: { fullName: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toNote);
    });
  }

  addNote(t: TenantContext, id: string, body: string, imageUrl: string | null) {
    assertOwnFile(this.storage, t.barbershopId, imageUrl, 'imageUrl');
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const n = await tx.customerNote.create({
        data: {
          barbershopId: t.barbershopId,
          customerId: id,
          body,
          imageUrl,
          authorMembershipId: t.membershipId,
        },
        select: {
          id: true,
          body: true,
          imageUrl: true,
          createdAt: true,
          authorMembershipId: true,
          author: { select: { user: { select: { fullName: true } } } },
        },
      });
      return toNote(n);
    });
  }

  /** Solo el autor o quien tenga customers.manage. */
  removeNote(t: TenantContext, id: string, noteId: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.find(tx, t, id);
      const n = await tx.customerNote.findFirst({
        where: { id: noteId, customerId: id, barbershopId: t.barbershopId, deletedAt: null },
        select: { authorMembershipId: true },
      });
      if (!n) throw AppError.notFound('Nota');
      if (!can(t, 'customers.manage') && n.authorMembershipId !== t.membershipId)
        throw AppError.forbidden('Solo puedes borrar tus propias notas');
      await tx.customerNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
    });
  }

  // ─────────────── CSV ───────────────
  async exportCsv(t: TenantContext): Promise<string> {
    return this.prisma.run(
      tenantDb(t),
      async (tx) => {
        const shop = await tx.barbershop.findUniqueOrThrow({
          where: { id: t.barbershopId },
          select: { timezone: true },
        });
        const rows = await tx.customer.findMany({
          where: this.where(t, {}),
          select: customerSelect,
          orderBy: { fullName: 'asc' },
          take: 50_000,
        });
        const stats = await statsFor(
          tx,
          t.barbershopId,
          rows.map((r) => r.id),
        );
        const contact = can(t, 'customers.view_contact');
        return toCsv(
          [
            'nombre',
            'telefono',
            'email',
            'cumpleanos',
            'etiquetas',
            'visitas',
            'gasto_total',
            'ultima_visita',
            'no_asistio',
            'bloqueado',
            'cliente_desde',
          ],
          rows.map((c) => {
            const s = stats.get(c.id);
            return [
              c.fullName,
              c.phoneE164 ? (contact ? c.phoneE164 : maskPhone(c.phoneE164)) : '',
              c.email ? (contact ? c.email : maskEmail(c.email)) : '',
              c.birthday?.toISOString().slice(0, 10) ?? '',
              c.tags.join('; '),
              s?.visits ?? 0,
              ((s?.totalSpentCents ?? 0) / 100).toFixed(2),
              s?.lastVisitAt ? utcToLocalDate(s.lastVisitAt, shop.timezone) : '',
              c.noShowCount,
              c.isBlocked ? 'sí' : 'no',
              utcToLocalDate(c.createdAt, shop.timezone),
            ];
          }),
        );
      },
      { timeoutMs: 60_000 },
    );
  }

  /** Importa (o actualiza por teléfono/email) clientes desde CSV. Con dryRun valida sin guardar nada. */
  async importCsv(t: TenantContext, text: string, dryRun: boolean) {
    let rows: string[][];
    try {
      rows = parseCsv(text, MAX_IMPORT_ROWS + 1);
    } catch {
      throw badRequest('file', `El archivo supera ${MAX_IMPORT_ROWS} filas`);
    }
    if (rows.length < 2)
      throw badRequest(
        'file',
        'El archivo no tiene filas de datos (la primera fila debe ser el encabezado)',
      );
    const header = rows[0]!.map(normalizeHeader);
    const col = Object.fromEntries(
      Object.entries(HEADERS).map(([k, aliases]) => [
        k,
        header.findIndex((h) => aliases.includes(h)),
      ]),
    ) as Record<keyof typeof HEADERS, number>;
    if (col.name < 0) throw badRequest('file', 'Falta la columna "nombre"');
    if (col.phone < 0 && col.email < 0)
      throw badRequest('file', 'Falta una columna "telefono" o "email"');

    const run = async (tx: Tx) => {
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { country: true },
      });
      const result = {
        dryRun,
        rows: rows.length - 1,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; message: string }>,
        columns: Object.keys(col).filter((k) => col[k as keyof typeof col] >= 0),
      };
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]!;
        const cell = (k: keyof typeof HEADERS) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
        const rowNo = i + 1; // como lo ve el usuario en Excel
        const name = cell('name');
        const rawPhone = cell('phone');
        const email = cell('email').toLowerCase() || null;
        if (name.length < 2) {
          result.errors.push({ row: rowNo, message: 'Nombre vacío o muy corto' });
          result.skipped++;
          continue;
        }
        const phoneE164 = rawPhone ? normalizePhone(rawPhone, shop.country) : null;
        if (rawPhone && !phoneE164) {
          result.errors.push({ row: rowNo, message: `Teléfono inválido: "${rawPhone}"` });
          result.skipped++;
          continue;
        }
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          result.errors.push({ row: rowNo, message: `Email inválido: "${email}"` });
          result.skipped++;
          continue;
        }
        if (!phoneE164 && !email) {
          result.errors.push({ row: rowNo, message: 'Sin teléfono ni email' });
          result.skipped++;
          continue;
        }
        const birthday = parseBirthday(cell('birthday'));
        if (cell('birthday') && !birthday) {
          result.errors.push({
            row: rowNo,
            message: `Fecha de cumpleaños inválida: "${cell('birthday')}" (usa AAAA-MM-DD o DD/MM/AAAA)`,
          });
          result.skipped++;
          continue;
        }
        const tags = uniq(
          cell('tags')
            .split(/[;|]/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20)
            .map((x) => x.slice(0, 30)),
        );

        const existing = await tx.customer.findFirst({
          where: {
            barbershopId: t.barbershopId,
            deletedAt: null,
            ...(phoneE164 ? { phoneE164 } : { email }),
          },
          select: { id: true, email: true, birthday: true, tags: true },
        });
        if (existing) {
          await tx.customer.update({
            where: { id: existing.id },
            data: {
              email: existing.email ?? email,
              birthday: existing.birthday ?? birthday,
              tags: uniq([...existing.tags, ...tags]),
            },
          });
          result.updated++;
        } else {
          const c = await tx.customer.create({
            data: {
              barbershopId: t.barbershopId,
              fullName: name.slice(0, 120),
              phoneE164,
              email,
              birthday,
              tags,
            },
            select: { id: true },
          });
          const note = cell('notes');
          if (note)
            await tx.customerNote.create({
              data: {
                barbershopId: t.barbershopId,
                customerId: c.id,
                body: note.slice(0, 2000),
                authorMembershipId: t.membershipId,
              },
            });
          result.created++;
        }
      }
      if (dryRun) throw new DryRunRollback(result);
      await this.audit.record(tx, {
        action: 'shop.customer.import',
        barbershopId: t.barbershopId,
        diff: { created: result.created, updated: result.updated, skipped: result.skipped },
      });
      return result;
    };
    try {
      return await this.prisma.run(tenantDb(t), run, { timeoutMs: 120_000 });
    } catch (e) {
      if (e instanceof DryRunRollback) return e.result as Awaited<ReturnType<typeof run>>;
      throw e;
    }
  }

  // ─────────────── internos ───────────────
  /** Un barbero sin `appointments.view_all` solo ve a los clientes que atendió o tiene agendados. */
  private where(t: TenantContext, q: Partial<ListCustomersQueryDto>): Prisma.CustomerWhereInput {
    const digits = q.q?.replace(/\D/g, '') ?? '';
    return {
      barbershopId: t.barbershopId,
      deletedAt: null,
      ...(can(t, 'appointments.view_all')
        ? {}
        : {
            appointments: {
              some: {
                staffId: t.staffId ?? '00000000-0000-0000-0000-000000000000',
                deletedAt: null,
              },
            },
          }),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.blocked ? { isBlocked: q.blocked === 'true' } : {}),
      ...(q.q
        ? {
            OR: [
              { fullName: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
  }

  private async find(tx: Tx, t: TenantContext, id: string): Promise<CustomerRow> {
    const c = await tx.customer.findFirst({
      where: { ...this.where(t, {}), id },
      select: customerSelect,
    });
    if (!c) throw AppError.notFound('Cliente');
    return c;
  }

  private async checkPhone(
    tx: Tx,
    t: TenantContext,
    phone: string | null,
    exceptId?: string,
  ): Promise<string | null> {
    if (!phone) return null;
    const shop = await tx.barbershop.findUniqueOrThrow({
      where: { id: t.barbershopId },
      select: { country: true },
    });
    const e164 = normalizePhone(phone, shop.country);
    if (!e164) throw badRequest('phone', 'Teléfono inválido');
    const dup = await tx.customer.findFirst({
      where: {
        barbershopId: t.barbershopId,
        phoneE164: e164,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (dup)
      throw AppError.conflict('Ya existe un cliente con ese teléfono', ErrorCode.CONFLICT, {
        existingId: dup.id,
      });
    return e164;
  }

  private toDto(t: TenantContext, c: CustomerRow, stats: Map<string, Stats>) {
    const contact = can(t, 'customers.view_contact');
    const s = stats.get(c.id);
    return {
      id: c.id,
      fullName: c.fullName,
      phone: c.phoneE164 ? (contact ? c.phoneE164 : maskPhone(c.phoneE164)) : null,
      email: c.email ? (contact ? c.email : maskEmail(c.email)) : null,
      birthday: c.birthday,
      tags: c.tags,
      isBlocked: c.isBlocked,
      waOptIn: c.waOptIn,
      noShowCount: c.noShowCount,
      hasAccount: Boolean(c.userId),
      stats: {
        visits: s?.visits ?? 0,
        totalSpentCents: s?.totalSpentCents ?? 0,
        lastVisitAt: s?.lastVisitAt ?? c.lastVisitAt,
        nextAppointmentAt: s?.nextAppointmentAt ?? null,
        avgDaysBetweenVisits: s?.avgDaysBetweenVisits ?? null,
      },
      createdAt: c.createdAt,
    };
  }
}

type Stats = {
  visits: number;
  totalSpentCents: number;
  lastVisitAt: Date | null;
  nextAppointmentAt: Date | null;
  avgDaysBetweenVisits: number | null;
};

/** Estadísticas de un lote de clientes en 2 consultas agregadas (sin N+1). */
async function statsFor(tx: Tx, barbershopId: string, ids: string[]): Promise<Map<string, Stats>> {
  if (!ids.length) return new Map();
  const [done, next] = await Promise.all([
    tx.appointment.groupBy({
      by: ['customerId'],
      where: { barbershopId, customerId: { in: ids }, deletedAt: null, status: 'completed' },
      _count: { _all: true },
      _sum: { totalCents: true },
      _min: { startAt: true },
      _max: { startAt: true },
    }),
    tx.appointment.groupBy({
      by: ['customerId'],
      where: {
        barbershopId,
        customerId: { in: ids },
        deletedAt: null,
        status: { in: ['pending', 'confirmed'] },
        startAt: { gt: new Date() },
      },
      _min: { startAt: true },
    }),
  ]);
  const map = new Map<string, Stats>();
  for (const id of ids) {
    const d = done.find((x) => x.customerId === id);
    const n = d?._count._all ?? 0;
    const first = d?._min.startAt;
    const last = d?._max.startAt;
    map.set(id, {
      visits: n,
      totalSpentCents: d?._sum.totalCents ?? 0,
      lastVisitAt: last ?? null,
      nextAppointmentAt: next.find((x) => x.customerId === id)?._min.startAt ?? null,
      avgDaysBetweenVisits:
        n >= 2 && first && last
          ? Math.round(((last.getTime() - first.getTime()) / 86_400_000 / (n - 1)) * 10) / 10
          : null,
    });
  }
  return map;
}

function toNote(n: {
  id: string;
  body: string;
  imageUrl: string | null;
  createdAt: Date;
  authorMembershipId: string | null;
  author: { user: { fullName: string } | null } | null;
}) {
  return {
    id: n.id,
    body: n.body,
    imageUrl: n.imageUrl,
    createdAt: n.createdAt,
    author: n.authorMembershipId
      ? { membershipId: n.authorMembershipId, fullName: n.author?.user?.fullName ?? null }
      : null,
  };
}

function uniq(tags: string[]): string[] {
  return [...new Set(tags.map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

/** AAAA-MM-DD o DD/MM/AAAA (formato habitual en Perú). */
export function parseBirthday(raw: string): Date | null {
  if (!raw) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw)))
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  const valid =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    y >= 1900 &&
    date <= new Date();
  return valid ? date : null;
}
