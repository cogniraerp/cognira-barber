/** Fase 3 · paso 32: cambio de plan desde la barbería. */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DunningService } from '../../src/modules/billing/dunning.service';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

const DAY = 86_400_000;
let t: TestApp;
let owner: Client;
let A: TenantFixture;
let token: string;
const tag = randomUUID().slice(0, 6);
const code = (c: string) => `pc-${c}-${tag}`;

const api = () => ({
  get: (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', A.slug),
  post: (u: string, b?: object) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', A.slug)
      .send(b),
  del: (u: string) =>
    request(t.http).delete(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', A.slug),
});
const sub = async () =>
  (
    await owner.query<{
      code: string;
      interval: string;
      status: string;
      pending_code: string | null;
      pending_interval: string | null;
      pending_effective_at: Date | null;
    }>(
      `SELECT p.code, s.interval, s.status, pp.code AS pending_code, s.pending_interval, s.pending_effective_at
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id LEFT JOIN plans pp ON pp.id = s.pending_plan_id WHERE s.barbershop_id = $1`,
      [A.barbershopId],
    )
  ).rows[0]!;

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'plan');
  token = await t.tokenFor(A.ownerUserId);
  const plan = (c: string, name: string, month: number, staff: number | null, sort: number) =>
    owner.query(
      `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [randomUUID(), code(c), name, month, month * 10, JSON.stringify({ staff }), sort],
    );
  await plan('mini', 'Mini', 1900, 0, 90);
  await plan('basic', 'Básico', 4900, 5, 91);
  await plan('pro', 'Pro', 9900, null, 92);
  await owner.query(
    `UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = $2) WHERE barbershop_id = $1`,
    [A.barbershopId, code('basic')],
  );
  await owner.query(
    `UPDATE invoices SET status = 'paid', paid_at = now() WHERE barbershop_id = $1`,
    [A.barbershopId],
  );
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('cambio de plan desde la barbería', () => {
  it('en prueba cambia al instante y sin factura', async () => {
    expect((await sub()).status).toBe('trialing');
    const r = (
      await api()
        .post('/v1/shop/billing/change-plan', { planCode: code('pro'), interval: 'month' })
        .expect(200)
    ).body;
    expect(r).toEqual({ result: 'changed', invoice: null });
    expect((await sub()).code).toBe(code('pro'));
    await api()
      .post('/v1/shop/billing/change-plan', { planCode: code('pro'), interval: 'month' })
      .expect(409);
    // Volver al básico para el resto (en prueba también es inmediato).
    await api()
      .post('/v1/shop/billing/change-plan', { planCode: code('basic'), interval: 'month' })
      .expect(200);
  });

  it('activa a mitad de periodo: subir es inmediato con factura por la diferencia prorrateada', async () => {
    await owner.query(
      `UPDATE subscriptions SET status = 'active', trial_ends_at = NULL, current_period_end = now() + interval '15 days' WHERE barbershop_id = $1`,
      [A.barbershopId],
    );
    const opts = (await api().get('/v1/shop/billing/plans').expect(200)).body;
    const pro = opts.plans.find((p: { code: string }) => p.code === code('pro'));
    expect(pro.change).toBe('now');
    expect(pro.prorationCents).toBeGreaterThan(2300); // ~ (99 − 49) × 15/30 ≈ S/ 25
    expect(pro.prorationCents).toBeLessThan(2700);
    const r = (
      await api()
        .post('/v1/shop/billing/change-plan', { planCode: code('pro'), interval: 'month' })
        .expect(200)
    ).body;
    expect(r.result).toBe('changed');
    expect(r.invoice.amountCents).toBe(pro.prorationCents);
    expect((await sub()).code).toBe(code('pro'));
    const inv = (await api().get('/v1/shop/billing').expect(200)).body.invoices[0];
    expect(inv).toMatchObject({
      id: r.invoice.id,
      status: 'open',
      amountCents: r.invoice.amountCents,
    });
    // Se paga como cualquier factura (aquí, a mano) para seguir al día.
    await owner.query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [
      r.invoice.id,
    ]);
  });

  it('bajar de plan: se bloquea si sobran barberos; si no, queda programado y se puede cancelar', async () => {
    const opts = (await api().get('/v1/shop/billing/plans').expect(200)).body;
    const mini = opts.plans.find((p: { code: string }) => p.code === code('mini'));
    expect(mini).toMatchObject({
      change: 'scheduled',
      blockers: [{ key: 'staff', max: 0, current: 1 }],
    });
    const blocked = await api()
      .post('/v1/shop/billing/change-plan', { planCode: code('mini'), interval: 'month' })
      .expect(409);
    expect(blocked.body.detail ?? blocked.body.title).toMatch(/0 barberos \(tienes 1\)/);

    const r = (
      await api()
        .post('/v1/shop/billing/change-plan', { planCode: code('basic'), interval: 'year' })
        .expect(200)
    ).body;
    expect(r).toEqual({ result: 'scheduled', invoice: null });
    let s = await sub();
    expect(s).toMatchObject({
      code: code('pro'),
      pending_code: code('basic'),
      pending_interval: 'year',
    });
    const after = (await api().get('/v1/shop/billing/plans').expect(200)).body;
    expect(after.pending).toMatchObject({ planCode: code('basic'), interval: 'year' });
    await api().del('/v1/shop/billing/scheduled-change').expect(204);
    s = await sub();
    expect(s.pending_effective_at).toBeNull();
    await api().del('/v1/shop/billing/scheduled-change').expect(409);
  });

  it('la renovación sale con el plan programado y al llegar la fecha se aplica', async () => {
    await api()
      .post('/v1/shop/billing/change-plan', { planCode: code('basic'), interval: 'month' })
      .expect(200);
    // El periodo termina en 3 días: la factura de renovación ya debe salir al precio del Básico.
    await owner.query(
      `UPDATE subscriptions SET current_period_end = now() + interval '3 days', pending_effective_at = now() + interval '3 days' WHERE barbershop_id = $1`,
      [A.barbershopId],
    );
    // Las facturas anteriores terminan donde termina el periodo (coherente con el nuevo fin).
    await owner.query(
      `UPDATE invoices SET period_end = (SELECT current_period_end FROM subscriptions WHERE barbershop_id = $1) WHERE barbershop_id = $1`,
      [A.barbershopId],
    );
    const dunning = t.app.get(DunningService);
    await dunning.run(new Date());
    const [renewal] = (
      await owner.query<{ amount_cents: number; notes: string }>(
        `SELECT amount_cents, notes FROM invoices WHERE barbershop_id = $1 AND notes = 'Renovación automática'`,
        [A.barbershopId],
      )
    ).rows;
    expect(renewal!.amount_cents).toBe(4900);
    expect((await sub()).code).toBe(code('pro')); // todavía no llega la fecha
    expect(
      await dunning.applyScheduledChanges(new Date(Date.now() + 4 * DAY)),
    ).toBeGreaterThanOrEqual(1);
    expect(await sub()).toMatchObject({ code: code('basic'), pending_effective_at: null });
  });

  it('morosa no puede cambiar; el admin no puede cambiar', async () => {
    await owner.query(`UPDATE subscriptions SET status = 'past_due' WHERE barbershop_id = $1`, [
      A.barbershopId,
    ]);
    expect((await api().get('/v1/shop/billing/plans').expect(200)).body.canChange).toBe(false);
    await api()
      .post('/v1/shop/billing/change-plan', { planCode: code('pro'), interval: 'month' })
      .expect(409);
    await owner.query(`UPDATE subscriptions SET status = 'active' WHERE barbershop_id = $1`, [
      A.barbershopId,
    ]);
    const adminId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Admin', now())`,
      [adminId, `${adminId}@test.pe`],
    );
    await owner.query(
      `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'admin', 'active', now())`,
      [randomUUID(), A.barbershopId, adminId],
    );
    const adminToken = await t.tokenFor(adminId);
    await request(t.http)
      .post('/v1/shop/billing/change-plan')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-Slug', A.slug)
      .send({ planCode: code('pro'), interval: 'month' })
      .expect(403);
  });
});
