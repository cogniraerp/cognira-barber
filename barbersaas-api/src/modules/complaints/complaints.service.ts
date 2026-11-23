import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { pageArgs } from '../../common/http/zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import type { DbContext } from '../../infra/prisma/db-context';
import { PrismaService, type Tx } from '../../infra/prisma/prisma.service';
import { SenderRegistry } from '../notifications/sender-registry';
import type { ComplaintsQueryDto, CreateComplaintDto } from './complaints.dto';
import { complaintCode, dueDate, providerEmail, receiptEmail, responseEmail } from './rules';

const SYSTEM: DbContext = { kind: 'system' };
type Row = Prisma.ComplaintGetPayload<object>;
/** null = el libro de Cognira. */
type Book = { barbershopId: string | null };

/** Libro de Reclamaciones virtual: el de Cognira y uno por barbería. */
@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger('Complaints');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly senders: SenderRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────────────────── público ─────────────────────────

  /** Datos legales de Cognira (páginas legales y su libro). */
  platformInfo() {
    const e = this.env;
    return {
      tradeName: e.LEGAL_TRADE_NAME,
      legalName: e.LEGAL_NAME || null,
      taxId: e.LEGAL_RUC || null,
      address: e.LEGAL_ADDRESS || null,
      email: e.LEGAL_EMAIL || null,
    };
  }

  /** Datos de la barbería como proveedor (su libro, en su página pública). */
  async shopInfo(slug: string) {
    const shop = await this.findShop(slug);
    return {
      tradeName: shop.name,
      legalName: shop.legalName,
      taxId: shop.taxId,
      address: shop.address,
      email: shop.email,
    };
  }

  async createForPlatform(dto: CreateComplaintDto) {
    const info = this.platformInfo();
    return this.create({ barbershopId: null }, info, dto, {
      panelUrl: `${this.env.WEB_URL}/platform/reclamaciones`,
      notify: info.email ? [info.email] : [],
    });
  }

  async createForShop(slug: string, dto: CreateComplaintDto) {
    const shop = await this.findShop(slug);
    const owners = await this.prisma.run(SYSTEM, (tx) =>
      tx.membership.findMany({
        where: { barbershopId: shop.id, role: 'owner', status: 'active' },
        select: { user: { select: { email: true } } },
      }),
    );
    const notify = owners.flatMap((o) => (o.user ? [o.user.email] : []));
    if (!notify.length && shop.email) notify.push(shop.email);
    return this.create(
      { barbershopId: shop.id },
      { tradeName: shop.legalName ?? shop.name, taxId: shop.taxId, address: shop.address },
      dto,
      { panelUrl: `${this.env.WEB_URL}/s/${shop.slug}/configuracion/reclamaciones`, notify },
    );
  }

  // ───────────────────────── panel ─────────────────────────

  async list(db: DbContext, book: Book, q: ComplaintsQueryDto) {
    const now = new Date();
    const where = { barbershopId: book.barbershopId, ...(q.status ? { status: q.status } : {}) };
    const [rows, total, pendingCount, overdueCount] = await this.prisma.run(db, (tx) =>
      Promise.all([
        tx.complaint.findMany({ where, orderBy: { seq: 'desc' }, ...pageArgs(q) }),
        tx.complaint.count({ where }),
        tx.complaint.count({ where: { barbershopId: book.barbershopId, status: 'pending' } }),
        tx.complaint.count({
          where: { barbershopId: book.barbershopId, status: 'pending', dueAt: { lt: now } },
        }),
      ]),
    );
    return {
      items: rows.map((r) => this.toDto(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      pendingCount,
      overdueCount,
    };
  }

  async respond(db: DbContext, book: Book, id: string, response: string, userId: string) {
    const row = await this.prisma.run(db, async (tx) => {
      const now = new Date();
      const done = await tx.complaint.updateMany({
        where: { id, barbershopId: book.barbershopId, status: 'pending' },
        data: { status: 'answered', response, respondedAt: now, respondedBy: userId },
      });
      const r = await tx.complaint.findFirst({ where: { id, barbershopId: book.barbershopId } });
      if (!r) throw AppError.notFound('Reclamo');
      if (done.count === 0) throw AppError.conflict('Este reclamo ya fue respondido');
      await this.audit.record(tx, {
        action: 'complaint.respond',
        barbershopId: book.barbershopId,
        entity: 'complaint',
        entityId: id,
      });
      return r;
    });
    this.mail(
      row.consumerEmail,
      responseEmail({ ...this.sheet(row), response: row.response ?? response }),
    );
    return this.toDto(row, new Date());
  }

  // ───────────────────────── internos ─────────────────────────

  private async create(
    book: Book,
    provider: { tradeName: string; taxId: string | null; address: string | null },
    dto: CreateComplaintDto,
    opts: { panelUrl: string; notify: string[] },
  ) {
    const row = await this.prisma.run(SYSTEM, async (tx) => {
      const seq = await this.nextSeq(tx, book);
      const createdAt = new Date();
      const r = await tx.complaint.create({
        data: {
          barbershopId: book.barbershopId,
          seq,
          kind: dto.kind,
          providerName: provider.tradeName,
          providerTaxId: provider.taxId,
          providerAddress: provider.address,
          consumerName: dto.consumerName,
          docType: dto.docType,
          docNumber: dto.docNumber,
          consumerAddress: dto.consumerAddress,
          consumerPhone: dto.consumerPhone || null,
          consumerEmail: dto.consumerEmail,
          guardianName: dto.isMinor ? (dto.guardianName ?? null) : null,
          itemType: dto.itemType,
          itemDescription: dto.itemDescription,
          amountCents: dto.amountCents ?? null,
          detail: dto.detail,
          request: dto.request,
          dueAt: dueDate(createdAt),
          createdAt,
        },
      });
      await this.audit.record(tx, {
        action: 'complaint.create',
        barbershopId: book.barbershopId,
        entity: 'complaint',
        entityId: r.id,
      });
      return r;
    });
    const sheet = this.sheet(row);
    // La copia al consumidor es obligatoria; el aviso al proveedor, para que no se le pase el plazo.
    this.mail(row.consumerEmail, receiptEmail(sheet));
    for (const to of opts.notify) this.mail(to, providerEmail(sheet, opts.panelUrl));
    return { id: row.id, code: sheet.code, dueAt: row.dueAt };
  }

  /** Correlativo por libro: un candado por libro evita que dos hojas tomen el mismo número. */
  private async nextSeq(tx: Tx, book: Book): Promise<number> {
    const key = `complaints:${book.barbershopId ?? 'cognira'}`;
    // $executeRaw: la función devuelve void y $queryRaw no puede leer esa columna.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const agg = await tx.complaint.aggregate({
      where: { barbershopId: book.barbershopId },
      _max: { seq: true },
    });
    return (agg._max.seq ?? 0) + 1;
  }

  private async findShop(slug: string) {
    const normalized = slug.trim().toLowerCase();
    const shop = /^[a-z0-9-]{3,48}$/.test(normalized)
      ? await this.prisma.run(SYSTEM, (tx) =>
          tx.barbershop.findFirst({
            where: { slug: normalized, deletedAt: null, status: { not: 'onboarding' } },
            select: {
              id: true,
              slug: true,
              name: true,
              legalName: true,
              taxId: true,
              email: true,
              locations: {
                where: { isPrimary: true, deletedAt: null },
                select: { address: true },
                take: 1,
              },
            },
          }),
        )
      : null;
    if (!shop) throw AppError.notFound('Barbería');
    const { locations, ...rest } = shop;
    return { ...rest, address: locations[0]?.address ?? null };
  }

  private sheet(r: Row) {
    return {
      code: complaintCode(r.seq, r.createdAt),
      kind: r.kind,
      providerName: r.providerName,
      providerTaxId: r.providerTaxId,
      consumerName: r.consumerName,
      itemDescription: r.itemDescription,
      detail: r.detail,
      request: r.request,
      dueAt: r.dueAt,
    };
  }

  private toDto(r: Row, now: Date) {
    return {
      id: r.id,
      code: complaintCode(r.seq, r.createdAt),
      kind: r.kind,
      status: r.status,
      overdue: r.status === 'pending' && r.dueAt < now,
      providerName: r.providerName,
      providerTaxId: r.providerTaxId,
      consumerName: r.consumerName,
      docType: r.docType,
      docNumber: r.docNumber,
      consumerAddress: r.consumerAddress,
      consumerPhone: r.consumerPhone,
      consumerEmail: r.consumerEmail,
      guardianName: r.guardianName,
      itemType: r.itemType,
      itemDescription: r.itemDescription,
      amountCents: r.amountCents,
      detail: r.detail,
      request: r.request,
      response: r.response,
      respondedAt: r.respondedAt,
      dueAt: r.dueAt,
      createdAt: r.createdAt,
    };
  }

  private mail(to: string, msg: { subject: string; body: string }): void {
    let sender;
    try {
      sender = this.senders.email();
    } catch (e) {
      this.logger.error(`No se pudo enviar "${msg.subject}": ${(e as Error).message}`);
      return;
    }
    sender
      .send({ to, subject: msg.subject, body: msg.body })
      .catch((e: Error) => this.logger.error(`No se pudo enviar "${msg.subject}": ${e.message}`));
  }
}
