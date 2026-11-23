/** Fase 2 · paso 26: cobranza (renovación, avisos, morosidad, suspensión y reactivación). */
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
let dunning: DunningService;
let A: TenantFixture;
let B: TenantFixture;
let C: TenantFixture;
let superToken: string;
/** Fin del periodo pagado de A (fijo para todo el escenario). */
const T0 = new Date(Date.now() + 5 * DAY);
const at = (days: number) => new Date(T0.getTime() + days * DAY);

const shop = async (f: TenantFixture) => {
  const token = await t.tokenFor(f.ownerUserId);
  return (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', f.slug);
};
const sa = {
  get: (u: string) => request(t.http).get(u).set('Authorization', `Bearer ${superToken}`),
  post: (u: string, b?: object) =>
    request(t.http).post(u).set('Authorization', `Bearer ${superToken}`).send(b),
};
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await owner.query(sql, params)).rows as T[];
const state = async (f: TenantFixture) =>
  (
    await q<{ shop: string; reason: string | null; sub: string }>(
      `SELECT b.status AS shop, b.suspended_reason AS reason, s.status AS sub FROM barbershops b JOIN subscriptions s ON s.barbershop_id = b.id WHERE b.id = $1`,
      [f.barbershopId],
    )
  )[0]!;
const notices = async (f: TenantFixture) =>
  (
    await q<{ kind: string; status: string }>(
      `SELECT kind, status FROM billing_notices WHERE barbershop_id = $1 AND channel = 'email' ORDER BY created_at`,
      [f.barbershopId],
    )
  ).map((n) => `${n.kind}:${n.status}`);

/** Deja la suscripción activa, al día y pagada hasta `end`. */
async function activeUntil(f: TenantFixture, end: Date) {
  await q(
    `UPDATE invoices SET status = 'paid', paid_at = now(), period_end = $2, period_start = $2::timestamptz - interval '1 month' WHERE barbershop_id = $1`,
    [f.barbershopId, end],
  );
  await q(
    `UPDATE subscriptions SET status = 'active', trial_ends_at = NULL, current_period_end = $2 WHERE barbershop_id = $1`,
    [f.barbershopId, end],
  );
  await q(`UPDATE barbershops SET status = 'active' WHERE id = $1`, [f.barbershopId]);
}

beforeAll(async () => {
  t = await createTestApp();
  dunning = t.app.get(DunningService);
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'dun');
  B = await createTenant(owner, 'dunb');
  C = await createTenant(owner, 'dunc');
  await activeUntil(A, T0);
  await activeUntil(B, T0);
  await activeUntil(C, new Date(Date.now() + 40 * DAY));
  const su = randomUUID();
  await q(
    `INSERT INTO users (id, email, full_name, platform_role, updated_at) VALUES ($1, $2, 'Super', 'superadmin', now())`,
    [su, `${su}@test.pe`],
  );
  superToken = await t.tokenFor(su);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('cobranza', () => {
  it('a 7 días del fin del periodo emite la factura de renovación y avisa por correo (una sola vez)', async () => {
    await dunning.run(at(-8)); // aún no toca
    expect(
      await q(`SELECT 1 FROM invoices WHERE barbershop_id = $1 AND status = 'open'`, [
        A.barbershopId,
      ]),
    ).toHaveLength(0);
    await dunning.run(at(-5));
    await dunning.run(at(-5));
    const inv = await q<{ amount_cents: number; period_start: Date; due_at: Date; notes: string }>(
      `SELECT amount_cents, period_start, due_at, notes FROM invoices WHERE barbershop_id = $1 AND status = 'open'`,
      [A.barbershopId],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ amount_cents: 4900, notes: 'Renovación automática' });
    expect(inv[0]!.period_start.getTime()).toBe(T0.getTime());
    expect(inv[0]!.due_at.getTime()).toBe(T0.getTime());
    expect(await notices(A)).toEqual(['invoice_issued:sent']);
    const mail = await q<{ recipients: string[] }>(
      `SELECT recipients FROM billing_notices WHERE barbershop_id = $1 AND channel = 'email'`,
      [A.barbershopId],
    );
    expect(mail[0]!.recipients).toHaveLength(1);
    // WhatsApp: sin teléfono del dueño ni de la barbería → omitido (no fallido).
    const wa = await q<{ status: string; error: string }>(
      `SELECT status, error FROM billing_notices WHERE barbershop_id = $1 AND channel = 'whatsapp'`,
      [A.barbershopId],
    );
    expect(wa[0]).toMatchObject({
      status: 'skipped',
      error: 'Sin teléfono del dueño ni de la barbería',
    });
    // Con teléfono, los siguientes avisos salen también por WhatsApp.
    await q(`UPDATE barbershops SET phone = '987 654 321' WHERE id = $1`, [A.barbershopId]);
  });

  it('recordatorio, morosa al vencer (sigue funcionando) y último aviso', async () => {
    await dunning.run(at(-2));
    expect((await notices(A)).at(-1)).toBe('due_soon:sent');
    const waDue = await q<{ status: string; recipients: string[] }>(
      `SELECT status, recipients FROM billing_notices WHERE barbershop_id = $1 AND channel = 'whatsapp' AND kind = 'due_soon'`,
      [A.barbershopId],
    );
    expect(waDue[0]).toEqual({ status: 'sent', recipients: ['+51987654321'] });
    await dunning.run(at(1));
    expect(await state(A)).toEqual({ shop: 'active', reason: null, sub: 'past_due' });
    expect((await notices(A)).at(-1)).toBe('overdue:sent');
    await (await shop(A))('/v1/shop/services').expect(200);
    await dunning.run(at(5.5));
    expect((await notices(A)).at(-1)).toBe('final_warning:sent');
  });

  it('pasada la gracia se suspende: el panel se bloquea pero Suscripción sigue disponible para pagar', async () => {
    await dunning.run(at(7.1));
    await dunning.run(at(8)); // idempotente
    expect(await state(A)).toEqual({ shop: 'suspended', reason: 'billing', sub: 'suspended' });
    expect(await notices(A)).toEqual([
      'invoice_issued:sent',
      'due_soon:sent',
      'overdue:sent',
      'final_warning:sent',
      'suspended:sent',
    ]);
    const get = await shop(A);
    const blocked = await get('/v1/shop/services').expect(403);
    expect(blocked.body.code).toBe('TENANT_SUSPENDED');
    // El contexto (permitido aunque esté suspendida) dice por qué, para mostrar la pantalla de pago.
    const ctx = (await get('/v1/shop/context').expect(200)).body;
    expect(ctx.barbershop).toMatchObject({ status: 'suspended', suspendedReason: 'billing' });
    const billing = (await get('/v1/shop/billing').expect(200)).body;
    expect(billing.subscription.status).toBe('suspended');
    expect(billing.invoices[0]).toMatchObject({ status: 'open', amountCents: 4900 });
  });

  it('al pagar se reactiva sola y se avisa', async () => {
    const [inv] = await q<{ id: string }>(
      `SELECT id FROM invoices WHERE barbershop_id = $1 AND status = 'open'`,
      [A.barbershopId],
    );
    await sa
      .post(`/v1/platform/invoices/${inv!.id}/mark-paid`, { gatewayRef: 'YAPE-9' })
      .expect(200);
    expect(await state(A)).toEqual({ shop: 'active', reason: null, sub: 'active' });
    await dunning.sendPending();
    expect((await notices(A)).at(-1)).toBe('reactivated:sent');
    await (await shop(A))('/v1/shop/services').expect(200);
    const [sub] = await q<{ current_period_end: Date }>(
      `SELECT current_period_end FROM subscriptions WHERE barbershop_id = $1`,
      [A.barbershopId],
    );
    expect(sub!.current_period_end.getTime()).toBeGreaterThan(T0.getTime() + 27 * DAY);
  });

  it('una suspensión manual del superadmin no se levanta al pagar', async () => {
    // B quedó suspendida por cobranza en las corridas anteriores: la dejamos morosa pero activa.
    await q(
      `UPDATE barbershops SET status = 'active', suspended_reason = NULL, suspended_at = NULL WHERE id = $1`,
      [B.barbershopId],
    );
    await q(`UPDATE subscriptions SET status = 'past_due' WHERE barbershop_id = $1`, [
      B.barbershopId,
    ]);
    await sa
      .post(`/v1/platform/barbershops/${B.barbershopId}/suspend`, { reason: 'Uso indebido' })
      .expect(200);
    const [inv] = await q<{ id: string }>(
      `SELECT id FROM invoices WHERE barbershop_id = $1 AND status = 'open'`,
      [B.barbershopId],
    );
    await sa.post(`/v1/platform/invoices/${inv!.id}/mark-paid`, {}).expect(200);
    expect(await state(B)).toEqual({ shop: 'suspended', reason: 'manual', sub: 'active' });
  });

  it('tablero de cobranza (solo superadmin) y ejecución manual', async () => {
    // C: factura abierta vencida hace 3 días (con el reloj real).
    await q(
      `INSERT INTO invoices (id, barbershop_id, subscription_id, number, amount_cents, currency, period_start, period_end, due_at, updated_at)
       SELECT $1, s.barbershop_id, s.id, $2, 4900, 'PEN', now(), now() + interval '1 month', now() - interval '3 days', now() FROM subscriptions s WHERE s.barbershop_id = $3`,
      [randomUUID(), `INV-C-${Date.now()}`, C.barbershopId],
    );
    const run = (await sa.post('/v1/platform/collections/run').expect(200)).body;
    expect(run.pastDue).toBeGreaterThanOrEqual(1);
    expect((await state(C)).sub).toBe('past_due');
    const d = (await sa.get('/v1/platform/collections').expect(200)).body;
    expect(d.config).toEqual({ renewalLeadDays: 7, reminderDays: 3, graceDays: 7 });
    const row = d.delinquent.find(
      (x: { barbershop: { id: string } }) => x.barbershop.id === C.barbershopId,
    );
    expect(row).toMatchObject({
      owedCents: 4900,
      invoices: 1,
      daysOverdue: 3,
      subscriptionStatus: 'past_due',
      lastNotice: { kind: 'overdue', status: 'sent' },
    });
    expect(d.kpis.overdueCents).toBeGreaterThanOrEqual(4900);
    const token = await t.tokenFor(C.ownerUserId);
    await request(t.http)
      .get('/v1/platform/collections')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
