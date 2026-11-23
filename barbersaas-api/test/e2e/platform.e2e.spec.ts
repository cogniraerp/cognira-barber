import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let superToken: string;
let supportToken: string;
let userToken: string;
let A: TenantFixture;
const suffix = Math.random().toString(36).slice(2, 7);
const planCode = `pro-${suffix}`;

async function createUser(
  role: 'superadmin' | 'support' | null,
  email = `${randomUUID()}@test.pe`,
) {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'U', $3, now())`,
    [id, email, role],
  );
  return id;
}

const as = (token: string) => ({
  get: (url: string) => request(t.http).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string, body?: object) =>
    request(t.http).post(url).set('Authorization', `Bearer ${token}`).send(body),
  patch: (url: string, body?: object) =>
    request(t.http).patch(url).set('Authorization', `Bearer ${token}`).send(body),
  delete: (url: string, body?: object) =>
    request(t.http).delete(url).set('Authorization', `Bearer ${token}`).send(body),
});

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  superToken = await t.tokenFor(await createUser('superadmin'));
  supportToken = await t.tokenFor(await createUser('support'));
  userToken = await t.tokenFor(await createUser(null));
  A = await createTenant(owner, 'pl');
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('control de acceso', () => {
  it('un usuario normal no entra al panel de plataforma', async () => {
    for (const url of [
      '/v1/platform/plans',
      '/v1/platform/barbershops',
      '/v1/platform/dashboard',
      '/v1/platform/invoices',
    ]) {
      expect((await as(userToken).get(url)).status).toBe(403);
    }
  });

  it('soporte: lee barberías y planes, pero no facturación ni dashboard, ni puede modificar', async () => {
    expect((await as(supportToken).get('/v1/platform/barbershops')).status).toBe(200);
    expect((await as(supportToken).get('/v1/platform/plans')).status).toBe(200);
    expect((await as(supportToken).get('/v1/platform/invoices')).status).toBe(403);
    expect((await as(supportToken).get('/v1/platform/dashboard')).status).toBe(403);
    expect(
      (
        await as(supportToken).post(`/v1/platform/barbershops/${A.barbershopId}/suspend`, {
          reason: 'test',
        })
      ).status,
    ).toBe(403);
    expect((await as(supportToken).post('/v1/platform/plans', {})).status).toBe(403);
  });

  it('un token de impersonación no sirve para el panel de plataforma', async () => {
    const imp = await as(superToken).post(`/v1/platform/barbershops/${A.barbershopId}/impersonate`);
    expect((await as(imp.body.accessToken).get('/v1/platform/barbershops')).status).toBe(403);
  });
});

describe('planes', () => {
  let planId: string;

  it('crea un plan con límites y features (defaults aplicados)', async () => {
    const res = await as(superToken)
      .post('/v1/platform/plans', {
        code: planCode,
        name: 'Pro',
        priceMonthlyCents: 9900,
        priceYearlyCents: 99000,
        limits: { staff: 5, whatsappPerMonth: 500 },
        features: { loyalty: true },
      })
      .expect(201);
    planId = res.body.id;
    expect(res.body).toMatchObject({
      code: planCode,
      currency: 'PEN',
      trialDays: 14,
      limits: { staff: 5, whatsappPerMonth: 500, services: null },
      features: { loyalty: true, api: false },
      activeSubscriptions: 0,
    });
    expect(res.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('código duplicado → 409; datos inválidos → 400', async () => {
    await as(superToken)
      .post('/v1/platform/plans', {
        code: planCode,
        name: 'Duplicado',
        priceMonthlyCents: 1,
        priceYearlyCents: 1,
      })
      .expect(409);
    const bad = await as(superToken)
      .post('/v1/platform/plans', {
        code: 'A B',
        name: 'X',
        priceMonthlyCents: -1,
        priceYearlyCents: 1,
      })
      .expect(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['code', 'priceMonthlyCents']),
    );
  });

  it('actualiza y luego elimina (soft delete: deja de listarse)', async () => {
    const upd = await as(superToken)
      .patch(`/v1/platform/plans/${planId}`, { name: 'Pro+', limits: { staff: 8 } })
      .expect(200);
    expect(upd.body).toMatchObject({ name: 'Pro+', limits: { staff: 8 } });

    const tmp = await as(superToken)
      .post('/v1/platform/plans', {
        code: `tmp-${suffix}`,
        name: 'Tmp',
        priceMonthlyCents: 0,
        priceYearlyCents: 0,
      })
      .expect(201);
    await as(superToken).delete(`/v1/platform/plans/${tmp.body.id}`).expect(204);
    const list = await as(superToken).get('/v1/platform/plans').expect(200);
    expect(list.body.map((p: { code: string }) => p.code)).not.toContain(`tmp-${suffix}`);
    await as(superToken).get(`/v1/platform/plans/${tmp.body.id}`).expect(404);
  });

  it('id mal formado → 404 (no 500)', async () => {
    await as(superToken).get('/v1/platform/plans/no-es-uuid').expect(404);
  });
});

describe('alta manual de barberías', () => {
  it('con un email que ya tiene cuenta → owner activo, sede principal, settings y prueba', async () => {
    const email = `dueno-${suffix}@test.pe`;
    const ownerId = await createUser(null, email);
    const slug = `alta-${suffix}`;
    const res = await as(superToken)
      .post('/v1/platform/barbershops', {
        name: 'Barbería Alta',
        slug,
        ownerEmail: email.toUpperCase(),
        planCode,
      })
      .expect(201);
    expect(res.body).toMatchObject({ slug, ownerStatus: 'active', inviteToken: null });

    const { rows } = await owner.query(
      `SELECT b.status, s.status AS sub_status, s.trial_ends_at,
              (SELECT count(*)::int FROM locations l WHERE l.barbershop_id = b.id AND l.is_primary) AS primary_locations,
              (SELECT count(*)::int FROM barbershop_settings x WHERE x.barbershop_id = b.id) AS settings,
              (SELECT m.role FROM memberships m WHERE m.barbershop_id = b.id AND m.user_id = $2 AND m.status = 'active') AS role
       FROM barbershops b JOIN subscriptions s ON s.barbershop_id = b.id WHERE b.id = $1`,
      [res.body.id, ownerId],
    );
    expect(rows[0]).toMatchObject({
      status: 'onboarding',
      sub_status: 'trialing',
      primary_locations: 1,
      settings: 1,
      role: 'owner',
    });
    const days = (new Date(rows[0].trial_ends_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    // El nuevo owner ya puede entrar a su panel.
    const ctx = await request(t.http)
      .get('/v1/shop/context')
      .set('Authorization', `Bearer ${await t.tokenFor(ownerId)}`)
      .set('X-Tenant-Slug', slug)
      .expect(200);
    expect(ctx.body.plan.code).toBe(planCode);
  });

  it('con un email sin cuenta → invitación (se guarda solo el hash del token)', async () => {
    const res = await as(superToken)
      .post('/v1/platform/barbershops', {
        name: 'Invitada',
        slug: `inv-${suffix}`,
        ownerEmail: `nuevo-${suffix}@test.pe`,
        planCode,
        trialDays: 0,
      })
      .expect(201);
    expect(res.body.ownerStatus).toBe('invited');
    expect(res.body.inviteToken).toEqual(expect.any(String));
    const { rows } = await owner.query(
      `SELECT m.invite_token, m.invite_email, s.status FROM memberships m JOIN subscriptions s USING (barbershop_id) WHERE m.barbershop_id = $1`,
      [res.body.id],
    );
    expect(rows[0].invite_email).toBe(`nuevo-${suffix}@test.pe`);
    expect(rows[0].invite_token).not.toBe(res.body.inviteToken);
    expect(rows[0].invite_token).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].status).toBe('active'); // trialDays: 0 → sin prueba
  });

  it('slug repetido → 409; slug reservado o plan inexistente → 400', async () => {
    const base = { name: 'Barbería X', ownerEmail: `x-${suffix}@test.pe`, planCode };
    await as(superToken)
      .post('/v1/platform/barbershops', { ...base, slug: A.slug })
      .expect(409);
    await as(superToken)
      .post('/v1/platform/barbershops', { ...base, slug: 'admin' })
      .expect(400);
    const r = await as(superToken)
      .post('/v1/platform/barbershops', { ...base, slug: `ok-${suffix}`, planCode: 'no-existe' })
      .expect(400);
    expect(r.body.field).toBe('planCode');
  });
});

describe('listado y detalle', () => {
  it('busca por nombre/slug, filtra y pagina', async () => {
    const res = await as(superToken)
      .get(`/v1/platform/barbershops?q=${suffix}&pageSize=1&sort=name`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ subscription: { plan: { code: planCode } } });

    const byPlan = await as(superToken)
      .get(`/v1/platform/barbershops?planCode=${planCode}`)
      .expect(200);
    expect(
      byPlan.body.items.every(
        (i: { subscription: { plan: { code: string } } }) => i.subscription.plan.code === planCode,
      ),
    ).toBe(true);

    const bad = await as(superToken).get('/v1/platform/barbershops?pageSize=500').expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });

  it('el detalle trae uso y miembros; para soporte, sin suscripción', async () => {
    const sup = await as(superToken).get(`/v1/platform/barbershops/${A.barbershopId}`).expect(200);
    expect(sup.body).toMatchObject({
      id: A.barbershopId,
      ownerEmail: expect.stringContaining('owner-'),
      subscription: { status: 'trialing', plan: { code: 'test-basic' } },
      usage: { staff: 1, locations: 1, services: 1, customers: 1, whatsappThisMonth: 0 },
    });
    expect(sup.body.members).toEqual([
      expect.objectContaining({ role: 'owner', status: 'active' }),
    ]);

    const supp = await as(supportToken)
      .get(`/v1/platform/barbershops/${A.barbershopId}`)
      .expect(200);
    expect(supp.body.subscription).toBeNull();
    expect(supp.body.usage.staff).toBe(1);

    const list = await as(supportToken).get(`/v1/platform/barbershops?q=${A.slug}`).expect(200);
    expect(list.body.items[0].subscription).toBeNull();
  });
});

describe('ciclo de vida', () => {
  let S: TenantFixture;
  beforeAll(async () => {
    S = await createTenant(owner, 'lc');
  });

  it('suspender → el owner ve status suspended; reactivar → active; queda auditado', async () => {
    await as(superToken)
      .post(`/v1/platform/barbershops/${S.barbershopId}/suspend`, { reason: 'Falta de pago' })
      .expect(200);
    await as(superToken)
      .post(`/v1/platform/barbershops/${S.barbershopId}/suspend`, { reason: 'Otra vez' })
      .expect(409);
    const ownerCtx = () =>
      t
        .tokenFor(S.ownerUserId)
        .then((tk) =>
          request(t.http)
            .get('/v1/shop/context')
            .set('Authorization', `Bearer ${tk}`)
            .set('X-Tenant-Slug', S.slug),
        );
    expect((await ownerCtx()).body.barbershop.status).toBe('suspended');

    const re = await as(superToken)
      .post(`/v1/platform/barbershops/${S.barbershopId}/reactivate`)
      .expect(200);
    expect(re.body.status).toBe('active');
    expect((await ownerCtx()).body.barbershop.status).toBe('active');

    const audit = await as(superToken)
      .get(`/v1/platform/audit-logs?barbershopId=${S.barbershopId}&action=platform.barbershop`)
      .expect(200);
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual([
      'platform.barbershop.reactivate',
      'platform.barbershop.suspend',
    ]);
    expect(audit.body.items[1].diff).toMatchObject({ reason: 'Falta de pago' });
  });

  it('extender la prueba suma días desde el fin actual', async () => {
    const before = await as(superToken).get(`/v1/platform/barbershops/${S.barbershopId}`);
    const res = await as(superToken)
      .post(`/v1/platform/barbershops/${S.barbershopId}/extend-trial`, { days: 10 })
      .expect(200);
    const prev = before.body.subscription.trialEndsAt
      ? new Date(before.body.subscription.trialEndsAt).getTime()
      : Date.now();
    const diffDays =
      (new Date(res.body.subscription.trialEndsAt).getTime() - Math.max(prev, Date.now())) /
      86_400_000;
    expect(diffDays).toBeGreaterThan(9.9);
    expect(diffDays).toBeLessThan(10.1);
  });

  it('cambiar de plan con override de límites y descuento', async () => {
    const res = await as(superToken)
      .post(`/v1/platform/barbershops/${S.barbershopId}/change-plan`, {
        planCode,
        discountPercent: 20,
        limitsOverride: { staff: 50 },
      })
      .expect(200);
    expect(res.body.subscription).toMatchObject({
      plan: { code: planCode },
      discountPercent: 20,
      limitsOverride: { staff: 50 },
    });
    const ctx = await request(t.http)
      .get('/v1/shop/context')
      .set('Authorization', `Bearer ${await t.tokenFor(S.ownerUserId)}`)
      .set('X-Tenant-Slug', S.slug);
    expect(ctx.body.plan.limits.staff).toBe(50);

    const cleared = await as(superToken)
      .post(`/v1/platform/barbershops/${S.barbershopId}/change-plan`, {
        planCode,
        limitsOverride: null,
      })
      .expect(200);
    expect(cleared.body.subscription.limitsOverride).toBeNull();
  });

  it('eliminar (soft): libera el slug, cancela la suscripción y bloquea el acceso', async () => {
    const D = await createTenant(owner, 'del');
    await as(superToken)
      .delete(`/v1/platform/barbershops/${D.barbershopId}`, { reason: 'Pedido del cliente' })
      .expect(204);
    await request(t.http)
      .get('/v1/shop/context')
      .set('Authorization', `Bearer ${await t.tokenFor(D.ownerUserId)}`)
      .set('X-Tenant-Slug', D.slug)
      .expect(404);
    const { rows } = await owner.query(
      `SELECT status, canceled_at FROM subscriptions WHERE barbershop_id = $1`,
      [D.barbershopId],
    );
    expect(rows[0].status).toBe('canceled');
    expect(rows[0].canceled_at).not.toBeNull();
    const del = await as(superToken)
      .get(`/v1/platform/barbershops?status=deleted&q=${D.slug}`)
      .expect(200);
    expect(del.body.items).toHaveLength(1);
    // El slug queda libre para otra barbería.
    await as(superToken)
      .post('/v1/platform/barbershops', {
        name: 'Reuso',
        slug: D.slug,
        ownerEmail: `reuso-${suffix}@test.pe`,
        planCode,
      })
      .expect(201);
  });
});

describe('facturación manual', () => {
  it('emitir factura (precio del plan con descuento) y marcarla pagada → suscripción activa', async () => {
    const F = await createTenant(owner, 'fac');
    // La factura de ejemplo del fixture vence hoy: se anula para que esta sea la única.
    await owner.query(`UPDATE invoices SET status = 'void' WHERE barbershop_id = $1`, [
      F.barbershopId,
    ]);
    await as(superToken)
      .post(`/v1/platform/barbershops/${F.barbershopId}/change-plan`, {
        planCode,
        discountPercent: 10,
      })
      .expect(200);

    const inv = await as(superToken)
      .post(`/v1/platform/barbershops/${F.barbershopId}/invoices`, {})
      .expect(201);
    expect(inv.body).toMatchObject({
      status: 'open',
      amountCents: 8910,
      currency: 'PEN',
      barbershop: { id: F.barbershopId },
    });
    expect(inv.body.number).toMatch(/^INV-\d{8}-[0-9A-F]{8}$/);

    const paid = await as(superToken)
      .post(`/v1/platform/invoices/${inv.body.id}/mark-paid`, { gatewayRef: 'YAPE-123' })
      .expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', gatewayRef: 'YAPE-123' });
    await as(superToken).post(`/v1/platform/invoices/${inv.body.id}/mark-paid`, {}).expect(409);

    const detail = await as(superToken)
      .get(`/v1/platform/barbershops/${F.barbershopId}`)
      .expect(200);
    expect(detail.body.subscription).toMatchObject({
      status: 'active',
      trialEndsAt: null,
      currentPeriodEnd: inv.body.periodEnd,
    });

    const list = await as(superToken)
      .get(`/v1/platform/invoices?barbershopId=${F.barbershopId}&status=paid`)
      .expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([inv.body.id]);
  });

  it('anular una factura abierta; una pagada no se puede anular', async () => {
    const F = await createTenant(owner, 'void');
    const inv = await as(superToken)
      .post(`/v1/platform/barbershops/${F.barbershopId}/invoices`, { amountCents: 100 })
      .expect(201);
    await as(superToken)
      .post(`/v1/platform/invoices/${inv.body.id}/void`, { reason: 'Error de monto' })
      .expect(200);
    await as(superToken).post(`/v1/platform/invoices/${inv.body.id}/mark-paid`, {}).expect(409);
  });
});

describe('impersonación', () => {
  it('superadmin obtiene un token corto que funciona como owner en esa barbería y queda auditado', async () => {
    const res = await as(superToken)
      .post(`/v1/platform/barbershops/${A.barbershopId}/impersonate`)
      .expect(201);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 1800,
      barbershop: { slug: A.slug },
    });
    const ctx = await request(t.http)
      .get('/v1/shop/context')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .set('X-Tenant-Slug', A.slug)
      .expect(200);
    expect(ctx.body).toMatchObject({ role: 'owner', impersonatedBy: 'superadmin' });
    expect(ctx.body.permissions).toContain('billing.manage');

    const audit = await as(superToken)
      .get(`/v1/platform/audit-logs?barbershopId=${A.barbershopId}&action=platform.impersonate`)
      .expect(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
  });

  it('soporte impersona sin facturación', async () => {
    const res = await as(supportToken)
      .post(`/v1/platform/barbershops/${A.barbershopId}/impersonate`)
      .expect(201);
    const ctx = await request(t.http)
      .get('/v1/shop/context')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .set('X-Tenant-Slug', A.slug)
      .expect(200);
    expect(ctx.body.impersonatedBy).toBe('support');
    expect(ctx.body.permissions).not.toContain('billing.view');
  });

  it('no se puede impersonar una barbería eliminada', async () => {
    const D = await createTenant(owner, 'impdel');
    await as(superToken)
      .delete(`/v1/platform/barbershops/${D.barbershopId}`, { reason: 'Prueba' })
      .expect(204);
    await as(superToken).post(`/v1/platform/barbershops/${D.barbershopId}/impersonate`).expect(404);
  });
});

describe('dashboard', () => {
  it('estructura completa y el MRR refleja una suscripción que pasa a activa', async () => {
    const before = await as(superToken).get('/v1/platform/dashboard').expect(200);
    expect(before.body.signups30d).toHaveLength(30);
    expect(before.body.barbershops.total).toBeGreaterThan(0);

    const M = await createTenant(owner, 'mrr');
    // La factura de ejemplo del fixture vence hoy: se anula para que esta sea la única.
    await owner.query(`UPDATE invoices SET status = 'void' WHERE barbershop_id = $1`, [
      M.barbershopId,
    ]);
    await as(superToken)
      .post(`/v1/platform/barbershops/${M.barbershopId}/change-plan`, {
        planCode,
        discountPercent: 0,
      })
      .expect(200);
    const inv = await as(superToken)
      .post(`/v1/platform/barbershops/${M.barbershopId}/invoices`, {})
      .expect(201);
    await as(superToken).post(`/v1/platform/invoices/${inv.body.id}/mark-paid`, {}).expect(200);

    const after = await as(superToken).get('/v1/platform/dashboard').expect(200);
    const pen = (b: { mrr: Array<{ currency: string; amountCents: number }> }) =>
      b.mrr.find((m) => m.currency === 'PEN')?.amountCents ?? 0;
    expect(pen(after.body) - pen(before.body)).toBe(9900);
    expect(after.body.subscriptions.active - before.body.subscriptions.active).toBe(1);
    const today = after.body.signups30d.at(-1);
    expect(today.count).toBeGreaterThan(0);
  });
});
