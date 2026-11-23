import { randomUUID } from 'node:crypto';
import { Controller, Get, Post } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanLimitsService } from '../../src/common/plan-limits/plan-limits.service';
import { RequirePermissions } from '../../src/common/rbac/require-permissions';
import { CurrentTenant, TenantScoped } from '../../src/common/tenancy/decorators';
import { tenantDb, type TenantContext } from '../../src/common/tenancy/tenant.types';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

/** Controlador solo para tests: una ruta tenant-scoped normal (no permitida si está suspendida). */
@TenantScoped()
@Controller('shop/__test')
class ProbeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
  ) {}

  @Get('services')
  @RequirePermissions('services.manage')
  services(@CurrentTenant() t: TenantContext) {
    return this.prisma.run(tenantDb(t), (tx) =>
      tx.service.findMany({ select: { barbershopId: true } }),
    );
  }

  @Post('staff')
  @RequirePermissions('staff.manage')
  async createStaff(@CurrentTenant() t: TenantContext) {
    return this.prisma.run(tenantDb(t), async (tx) => {
      await this.limits.assertCanCreate(tx, t.barbershopId, 'staff');
      return tx.staff.create({
        data: { barbershopId: t.barbershopId, displayName: 'Nuevo' },
        select: { id: true },
      });
    });
  }
}

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let B: TenantFixture;
let barberUserId: string;

beforeAll(async () => {
  t = await createTestApp([ProbeController]);
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'ta');
  B = await createTenant(owner, 'tb');

  // Un barbero en A, y la barbería A oculta los teléfonos a los barberos.
  barberUserId = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Barbero', now())`,
    [barberUserId, `barber-${barberUserId}@test.pe`],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [randomUUID(), A.barbershopId, barberUserId],
  );
  await owner.query(
    `UPDATE barbershop_settings SET permissions = '{"barber": {"customers.view_contact": false}}' WHERE barbershop_id = $1`,
    [A.barbershopId],
  );
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

const ctx = (token: string, slug?: string) => {
  const r = request(t.http).get('/v1/shop/context').set('Authorization', `Bearer ${token}`);
  return slug ? r.set('X-Tenant-Slug', slug) : r;
};

describe('resolución de la barbería', () => {
  it('sin X-Tenant-Slug → 400 TENANT_REQUIRED', async () => {
    const res = await ctx(await t.tokenFor(A.ownerUserId)).expect(400);
    expect(res.body.code).toBe('TENANT_REQUIRED');
  });

  it('slug inexistente o mal formado → 404 TENANT_NOT_FOUND', async () => {
    const token = await t.tokenFor(A.ownerUserId);
    expect((await ctx(token, 'no-existe-xyz').expect(404)).body.code).toBe('TENANT_NOT_FOUND');
    expect((await ctx(token, '../../etc').expect(404)).body.code).toBe('TENANT_NOT_FOUND');
  });

  it('owner de A en A → contexto completo (el slug no distingue mayúsculas)', async () => {
    const res = await ctx(await t.tokenFor(A.ownerUserId), A.slug.toUpperCase()).expect(200);
    expect(res.body).toMatchObject({
      barbershop: { id: A.barbershopId, slug: A.slug, timezone: 'America/Lima', currency: 'PEN' },
      role: 'owner',
      impersonatedBy: null,
      plan: { code: 'test-basic' },
    });
    expect(res.body.permissions).toContain('billing.manage');
  });

  it('owner de A pidiendo la barbería B → 403', async () => {
    const res = await ctx(await t.tokenFor(A.ownerUserId), B.slug).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('sin token → 401 (antes que cualquier otra cosa)', async () => {
    await request(t.http).get('/v1/shop/context').set('X-Tenant-Slug', A.slug).expect(401);
  });
});

describe('permisos', () => {
  it('el barbero recibe sus permisos con los overrides de la barbería aplicados', async () => {
    const res = await ctx(await t.tokenFor(barberUserId), A.slug).expect(200);
    expect(res.body.role).toBe('barber');
    expect(res.body.permissions).toContain('appointments.view_own');
    expect(res.body.permissions).not.toContain('customers.view_contact');
    expect(res.body.permissions).not.toContain('billing.view');
  });

  it('@RequirePermissions: barbero → 403 con los permisos que faltan; owner → 200 solo con datos de A', async () => {
    const denied = await request(t.http)
      .get('/v1/shop/__test/services')
      .set('Authorization', `Bearer ${await t.tokenFor(barberUserId)}`)
      .set('X-Tenant-Slug', A.slug)
      .expect(403);
    expect(denied.body.missing).toEqual(['services.manage']);

    const ok = await request(t.http)
      .get('/v1/shop/__test/services')
      .set('Authorization', `Bearer ${await t.tokenFor(A.ownerUserId)}`)
      .set('X-Tenant-Slug', A.slug)
      .expect(200);
    expect(ok.body.length).toBeGreaterThan(0);
    expect(ok.body.every((s: { barbershopId: string }) => s.barbershopId === A.barbershopId)).toBe(
      true,
    );
  });

  it('una membership deshabilitada pierde el acceso', async () => {
    const userId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Ex', now())`,
      [userId, `ex-${userId}@test.pe`],
    );
    await owner.query(
      `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'admin', 'disabled', now())`,
      [randomUUID(), A.barbershopId, userId],
    );
    await ctx(await t.tokenFor(userId), A.slug).expect(403);
  });
});

describe('barbería suspendida', () => {
  it('permite /shop/context (para poder pagar) pero bloquea el resto con TENANT_SUSPENDED', async () => {
    const S = await createTenant(owner, 'ts');
    await owner.query(`UPDATE barbershops SET status = 'suspended' WHERE id = $1`, [
      S.barbershopId,
    ]);
    const token = await t.tokenFor(S.ownerUserId);
    const c = await ctx(token, S.slug).expect(200);
    expect(c.body.barbershop.status).toBe('suspended');
    const res = await request(t.http)
      .get('/v1/shop/__test/services')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', S.slug)
      .expect(403);
    expect(res.body.code).toBe('TENANT_SUSPENDED');
  });
});

describe('impersonación', () => {
  let supportId: string;
  beforeAll(async () => {
    supportId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'Soporte', 'support', now())`,
      [supportId, `support-${supportId}@test.pe`],
    );
  });

  it('soporte impersonando A: actúa como owner, sin facturación', async () => {
    const token = await t.tokenFor(supportId, undefined, {
      barbershopId: A.barbershopId,
      by: 'support',
    });
    const res = await ctx(token, A.slug).expect(200);
    expect(res.body).toMatchObject({ role: 'owner', impersonatedBy: 'support' });
    expect(res.body.permissions).not.toContain('billing.view');
    // Los límites del plan se siguen leyendo aunque la RLS le oculte la suscripción.
    expect(res.body.plan.code).toBe('test-basic');
  });

  it('el token de impersonación de A no sirve para B', async () => {
    const token = await t.tokenFor(supportId, undefined, {
      barbershopId: A.barbershopId,
      by: 'support',
    });
    await ctx(token, B.slug).expect(403);
  });

  it('si al emisor le quitan el rol de plataforma, el token deja de valer', async () => {
    const exId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'Ex soporte', 'support', now())`,
      [exId, `exsupport-${exId}@test.pe`],
    );
    const token = await t.tokenFor(exId, undefined, {
      barbershopId: A.barbershopId,
      by: 'support',
    });
    await ctx(token, A.slug).expect(200);
    await owner.query(`UPDATE users SET platform_role = NULL WHERE id = $1`, [exId]);
    await ctx(token, A.slug).expect(401);
  });

  it('un token de impersonación no puede reclamar un rol que el usuario no tiene', async () => {
    const token = await t.tokenFor(supportId, undefined, {
      barbershopId: A.barbershopId,
      by: 'superadmin',
    });
    await ctx(token, A.slug).expect(401);
  });
});

describe('GET /v1/me/barbershops', () => {
  it('lista solo las barberías del usuario, con su rol', async () => {
    const res = await request(t.http)
      .get('/v1/me/barbershops')
      .set('Authorization', `Bearer ${await t.tokenFor(A.ownerUserId)}`)
      .expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: A.barbershopId,
        slug: A.slug,
        role: 'owner',
        status: 'active',
      }),
    ]);
  });
});

describe('límites del plan', () => {
  it('al llegar al máximo de barberos → 402 PLAN_LIMIT_REACHED; no se crea nada', async () => {
    const L = await createTenant(owner, 'tl');
    // Plan propio con 2 barberos; la fixture ya trae 1.
    const planId = randomUUID();
    await owner.query(
      `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, updated_at)
       VALUES ($1, $2, 'Mini', 0, 0, '{"staff": 2}', now())`,
      [planId, `mini-${planId.slice(0, 8)}`],
    );
    await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
      planId,
      L.barbershopId,
    ]);

    const call = async () =>
      request(t.http)
        .post('/v1/shop/__test/staff')
        .set('Authorization', `Bearer ${await t.tokenFor(L.ownerUserId)}`)
        .set('X-Tenant-Slug', L.slug);

    expect((await call()).status).toBe(201);
    const res = await call();
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', limit: 'staff', max: 2 });
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM staff WHERE barbershop_id = $1`,
      [L.barbershopId],
    );
    expect(rows[0].n).toBe(2);
  });

  it('el override de la suscripción amplía el límite', async () => {
    const L = await createTenant(owner, 'to');
    const planId = randomUUID();
    await owner.query(
      `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, updated_at)
       VALUES ($1, $2, 'Mini', 0, 0, '{"staff": 1}', now())`,
      [planId, `mini-${planId.slice(0, 8)}`],
    );
    await owner.query(
      `UPDATE subscriptions SET plan_id = $1, limits_override = '{"staff": 5}' WHERE barbershop_id = $2`,
      [planId, L.barbershopId],
    );
    const res = await request(t.http)
      .post('/v1/shop/__test/staff')
      .set('Authorization', `Bearer ${await t.tokenFor(L.ownerUserId)}`)
      .set('X-Tenant-Slug', L.slug);
    expect(res.status).toBe(201);
  });
});
