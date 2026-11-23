import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, ErrorCode } from '../../../common/errors/app-error';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  resolvePermissions,
  ShopPermissionOverridesSchema,
  ungrantable,
} from '../../../common/rbac/permissions';
import { tenantDb, type TenantContext } from '../../../common/tenancy/tenant.types';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService, type Tx } from '../../../infra/prisma/prisma.service';
import { StorageProvider } from '../../../infra/storage/storage.provider';
import { assertOwnFile } from '../own-file';
import {
  BookingRulesSchema,
  readableOn,
  readBookingRules,
  readBranding,
  readPreferences,
  type BookingRules,
} from '../settings.schemas';
import type {
  CreateGalleryImageDto,
  UpdateBrandingDto,
  UpdateGalleryImageDto,
  UpdateGeneralSettingsDto,
  UpdatePermissionsDto,
  UpdateProfileDto,
} from './profile.dto';

const CONFIGURABLE_ROLES = ['admin', 'receptionist', 'barber'] as const;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageProvider,
  ) {}

  // ─────────────── Perfil ───────────────
  getProfile(t: TenantContext) {
    return this.prisma.run(tenantDb(t), (tx) => loadProfile(tx, t.barbershopId));
  }

  async updateProfile(t: TenantContext, dto: UpdateProfileDto) {
    if (dto.slug && dto.slug !== t.slug && t.role !== 'owner') {
      throw AppError.forbidden('Solo el owner puede cambiar el slug');
    }
    const { address, ...shopData } = dto;
    try {
      return await this.prisma.run(tenantDb(t), async (tx) => {
        if (Object.keys(shopData).length)
          await tx.barbershop.update({ where: { id: t.barbershopId }, data: shopData });
        if (address && Object.keys(address).length) {
          const loc = await primaryLocation(tx, t.barbershopId);
          await tx.location.update({ where: { id: loc.id }, data: address });
        }
        await this.audit.record(tx, {
          action: 'shop.profile.update',
          barbershopId: t.barbershopId,
          entity: 'barbershop',
          entityId: t.barbershopId,
          diff: dto,
        });
        return loadProfile(tx, t.barbershopId);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppError.conflict('Ese slug ya está en uso', ErrorCode.CONFLICT, { field: 'slug' });
      }
      throw e;
    }
  }

  // ─────────────── Marca ───────────────
  async getBranding(t: TenantContext) {
    const shop = await this.prisma.run(tenantDb(t), (tx) =>
      tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { branding: true },
      }),
    );
    return withForegrounds(readBranding(shop.branding));
  }

  updateBranding(t: TenantContext, dto: UpdateBrandingDto) {
    for (const f of ['logoUrl', 'faviconUrl', 'bannerUrl'] as const)
      assertOwnFile(this.storage, t.barbershopId, dto[f], f);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const shop = await tx.barbershop.findUniqueOrThrow({
        where: { id: t.barbershopId },
        select: { branding: true },
      });
      const current = readBranding(shop.branding);
      const next = readBranding({
        ...current,
        ...dto,
        socials: { ...current.socials, ...dto.socials },
      });
      await tx.barbershop.update({ where: { id: t.barbershopId }, data: { branding: next } });
      await this.audit.record(tx, {
        action: 'shop.branding.update',
        barbershopId: t.barbershopId,
        entity: 'barbershop',
        entityId: t.barbershopId,
        diff: dto,
      });
      return withForegrounds(next);
    });
  }

  // ─────────────── Galería ───────────────
  listGallery(t: TenantContext) {
    return this.prisma.run(tenantDb(t), (tx) =>
      tx.galleryImage.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: gallerySelect,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  }

  addGalleryImage(t: TenantContext, dto: CreateGalleryImageDto) {
    assertOwnFile(this.storage, t.barbershopId, dto.url, 'url');
    return this.prisma.run(tenantDb(t), async (tx) => {
      const count = await tx.galleryImage.count({
        where: { barbershopId: t.barbershopId, deletedAt: null },
      });
      if (count >= 60) throw AppError.conflict('Máximo 60 imágenes en la galería');
      return tx.galleryImage.create({
        data: {
          ...dto,
          caption: dto.caption ?? null,
          barbershopId: t.barbershopId,
          sortOrder: count,
        },
        select: gallerySelect,
      });
    });
  }

  updateGalleryImage(t: TenantContext, id: string, dto: UpdateGalleryImageDto) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findGalleryImage(tx, t.barbershopId, id);
      return tx.galleryImage.update({ where: { id }, data: dto, select: gallerySelect });
    });
  }

  removeGalleryImage(t: TenantContext, id: string) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await findGalleryImage(tx, t.barbershopId, id);
      await tx.galleryImage.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  reorderGallery(t: TenantContext, ids: string[]) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const existing = await tx.galleryImage.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: { id: true },
      });
      const known = new Set(existing.map((e) => e.id));
      if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
        throw AppError.conflict(
          'La lista debe contener exactamente todas las imágenes de la galería',
        );
      }
      await Promise.all(
        ids.map((id, i) => tx.galleryImage.update({ where: { id }, data: { sortOrder: i } })),
      );
      return tx.galleryImage.findMany({
        where: { barbershopId: t.barbershopId, deletedAt: null },
        select: gallerySelect,
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  // ─────────────── Reglas de reserva ───────────────
  async getBookingRules(t: TenantContext): Promise<BookingRules> {
    const s = await this.prisma.run(tenantDb(t), (tx) => settings(tx, t.barbershopId));
    return readBookingRules(s.bookingRules);
  }

  /** PUT: reemplazo completo (los campos ausentes vuelven a su default). */
  setBookingRules(t: TenantContext, rules: BookingRules) {
    const parsed = BookingRulesSchema.parse(rules);
    return this.prisma.run(tenantDb(t), async (tx) => {
      await settings(tx, t.barbershopId);
      await tx.barbershopSettings.update({
        where: { barbershopId: t.barbershopId },
        data: { bookingRules: parsed },
      });
      await this.audit.record(tx, {
        action: 'shop.settings.booking_rules',
        barbershopId: t.barbershopId,
        diff: parsed,
      });
      return parsed;
    });
  }

  // ─────────────── Preferencias generales ───────────────
  getGeneral(t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      const [s, shop] = await Promise.all([
        settings(tx, t.barbershopId),
        tx.barbershop.findUniqueOrThrow({
          where: { id: t.barbershopId },
          select: { locale: true, timezone: true, currency: true },
        }),
      ]);
      return {
        ...readPreferences(s.preferences),
        ...shop,
        locale: shop.locale as 'es-PE' | 'es' | 'en',
      };
    });
  }

  async updateGeneral(t: TenantContext, dto: UpdateGeneralSettingsDto) {
    const { locale, timezone, currency, ...prefs } = dto;
    await this.prisma.run(tenantDb(t), async (tx) => {
      const s = await settings(tx, t.barbershopId);
      await tx.barbershopSettings.update({
        where: { barbershopId: t.barbershopId },
        data: { preferences: { ...readPreferences(s.preferences), ...prefs } },
      });
      if (locale || timezone || currency) {
        await tx.barbershop.update({
          where: { id: t.barbershopId },
          data: { locale, timezone, currency },
        });
      }
      await this.audit.record(tx, {
        action: 'shop.settings.general',
        barbershopId: t.barbershopId,
        diff: dto,
      });
    });
    return this.getGeneral(t);
  }

  // ─────────────── Permisos por rol ───────────────
  async getPermissionMatrix(t: TenantContext) {
    const s = await this.prisma.run(tenantDb(t), (tx) => settings(tx, t.barbershopId));
    return matrix(s.permissions);
  }

  /**
   * Reemplaza los ajustes de permisos de los roles. El cliente envía el documento completo, así
   * que se compara contra lo guardado:
   *  - un no-owner nunca cambia el rol admin: se conservan los ajustes que puso el owner (y si
   *    intenta cambiarlos → 403);
   *  - "no puedes conceder lo que no tienes" se aplica solo a lo que CAMBIA (no a concesiones
   *    que el owner ya había hecho y que el formulario reenvía tal cual).
   */
  setPermissionMatrix(t: TenantContext, dto: UpdatePermissionsDto) {
    const overrides = ShopPermissionOverridesSchema.parse(dto);
    return this.prisma.run(tenantDb(t), async (tx) => {
      const current = await settings(tx, t.barbershopId);
      const parsed = ShopPermissionOverridesSchema.safeParse(current.permissions);
      const stored = parsed.success ? parsed.data : {};
      if (t.role !== 'owner') {
        // Omitirlo = conservarlo; enviarlo distinto = intentar cambiarlo.
        if (overrides.admin !== undefined && !sameOverrides(overrides.admin, stored.admin)) {
          throw AppError.forbidden('Solo el owner puede cambiar los permisos del rol admin');
        }
        if (stored.admin) overrides.admin = stored.admin;
        else delete overrides.admin;
      }
      const changed = Object.fromEntries(
        Object.entries(overrides).map(([role, o]) => [
          role,
          Object.fromEntries(
            Object.entries(o ?? {}).filter(
              ([perm, allowed]) => (stored as Record<string, Record<string, boolean> | undefined>)[role]?.[perm] !== allowed,
            ),
          ),
        ]),
      );
      const denied = [...new Set(Object.values(changed).flatMap((o) => ungrantable(t, o as never)))];
      if (denied.length)
        throw AppError.forbidden(`No puedes conceder permisos que no tienes: ${denied.join(', ')}`);
      await tx.barbershopSettings.update({
        where: { barbershopId: t.barbershopId },
        data: { permissions: overrides },
      });
      await this.audit.record(tx, {
        action: 'shop.settings.permissions',
        barbershopId: t.barbershopId,
        diff: overrides,
      });
      return matrix(overrides);
    });
  }
}

const gallerySelect = {
  id: true,
  url: true,
  caption: true,
  sortOrder: true,
  isVisible: true,
} as const;

async function loadProfile(tx: Tx, barbershopId: string) {
  const shop = await tx.barbershop.findUniqueOrThrow({
    where: { id: barbershopId },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      category: true,
      legalName: true,
      taxId: true,
      phone: true,
      email: true,
      status: true,
      locations: {
        where: { isPrimary: true, deletedAt: null },
        select: { id: true, address: true, reference: true, lat: true, lng: true },
        take: 1,
      },
    },
  });
  const { locations, ...rest } = shop;
  const loc = locations[0];
  return {
    ...rest,
    address: loc
      ? {
          locationId: loc.id,
          address: loc.address,
          reference: loc.reference,
          lat: loc.lat,
          lng: loc.lng,
        }
      : null,
  };
}

async function primaryLocation(tx: Tx, barbershopId: string) {
  const loc = await tx.location.findFirst({
    where: { barbershopId, isPrimary: true, deletedAt: null },
    select: { id: true },
  });
  if (loc) return loc;
  return tx.location.create({
    data: { barbershopId, name: 'Sede principal', isPrimary: true },
    select: { id: true },
  });
}

async function settings(tx: Tx, barbershopId: string) {
  return tx.barbershopSettings.upsert({
    where: { barbershopId },
    create: { barbershopId },
    update: {},
  });
}

async function findGalleryImage(tx: Tx, barbershopId: string, id: string) {
  const img = await tx.galleryImage.findFirst({
    where: { id, barbershopId, deletedAt: null },
    select: { id: true },
  });
  if (!img) throw AppError.notFound('Imagen');
}

function withForegrounds<T extends { primaryColor: string; secondaryColor: string }>(b: T) {
  return {
    ...b,
    primaryForeground: readableOn(b.primaryColor),
    secondaryForeground: readableOn(b.secondaryColor),
  };
}

/** Mismos ajustes (ignorando las claves que valen lo mismo que nada: objeto vacío = sin ajustes). */
function sameOverrides(a: Record<string, boolean> | undefined, b: Record<string, boolean> | undefined): boolean {
  const x = a ?? {};
  const y = b ?? {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k] === y[k]);
}

function matrix(rawOverrides: unknown) {
  const parsed = ShopPermissionOverridesSchema.safeParse(rawOverrides);
  const overrides = parsed.success ? parsed.data : {};
  return {
    catalog: [...PERMISSIONS],
    roles: CONFIGURABLE_ROLES.map((role) => ({
      role,
      defaults: [...DEFAULT_ROLE_PERMISSIONS[role]].sort(),
      overrides: overrides[role] ?? {},
      effective: [...resolvePermissions(role, overrides, {})].sort(),
    })),
  };
}
