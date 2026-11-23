/** Fase 3 · paso 28: adelantos al reservar (apartado, pago, vencimiento y reglas). */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DepositsService } from '../../src/modules/deposits/deposits.service';
import { RefundsService } from '../../src/modules/payments/refunds.service';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let A: TenantFixture; // plan con pagos en línea + simulador + adelanto 50 %
let B: TenantFixture; // plan básico: sin adelantos
let tokenA: string;

/** Un lunes a 7–13 días (dentro de maxAdvance y lejos de la ausencia del fixture). */
function monday(): string {
  const lima = new Date(Date.now() - 5 * 3600_000);
  for (let i = 7; i < 14; i++) {
    const d = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() + i));
    if (d.getUTCDay() === 1) return d.toISOString().slice(0, 10);
  }
  throw new Error('sin lunes');
}
const MON = monday();
const at = (hhmm: string) => new Date(`${MON}T${hhmm}:00-05:00`).toISOString();
const phone = () => `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const shop = (token: string, slug: string) => ({
  put: (u: string, b?: object) =>
    request(t.http)
      .put(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
  post: (u: string, b?: object) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
  patch: (u: string, b?: object) =>
    request(t.http)
      .patch(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(b),
  get: (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug),
});
const book = (f: TenantFixture, startAt: string, customerPhone = phone()) =>
  request(t.http)
    .post(`/v1/public/shops/${f.slug}/appointments`)
    .send({
      serviceIds: [f.serviceId],
      staffId: f.staffId,
      startAt,
      customer: { fullName: 'Cliente Adelanto', phone: customerPhone },
    });
const view = async (token: string) =>
  (await request(t.http).get(`/v1/public/appointments/${token}`).expect(200)).body;
/** El cliente paga en el checkout simulado. */
async function payLink(payUrl: string, action: 'pay' | 'reject' = 'pay') {
  const u = new URL(payUrl);
  await request(t.http)
    .post(u.pathname)
    .type('form')
    .send({ sig: u.searchParams.get('sig'), action })
    .expect(200);
}

async function setup(f: TenantFixture) {
  const token = await t.tokenFor(f.ownerUserId);
  const o = shop(token, f.slug);
  await o
    .put(`/v1/shop/locations/${f.locationId}/hours`, {
      days: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        blocks: [{ start: '09:00', end: '19:00' }],
      })),
    })
    .expect(200);
  return { token, o };
}

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'dep');
  B = await createTenant(owner, 'depb');
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, features, updated_at)
     VALUES ($1, 'test-pro-dep', 'Pro', 9900, 99000, '{"onlinePayments": true}', now())
     ON CONFLICT (code) DO UPDATE SET features = EXCLUDED.features RETURNING id`,
    [randomUUID()],
  );
  await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
    rows[0]!.id,
    A.barbershopId,
  ]);
  const a = await setup(A);
  tokenA = a.token;
  await a.o.post('/v1/shop/payment-gateways', { provider: 'simulator' }).expect(201);
  const rules = (await a.o.get('/v1/shop/settings/booking-rules').expect(200)).body;
  await a.o
    .put('/v1/shop/settings/booking-rules', {
      ...rules,
      minNoticeMinutes: 0,
      deposit: { required: true, type: 'percent', value: 50, appliesTo: 'all', holdMinutes: 15 },
    })
    .expect(200);
  const b = await setup(B);
  const rulesB = (await b.o.get('/v1/shop/settings/booking-rules').expect(200)).body;
  // B pide adelanto pero su plan no tiene pagos en línea: se reserva como siempre.
  await b.o
    .put('/v1/shop/settings/booking-rules', {
      ...rulesB,
      deposit: { ...rulesB.deposit, required: true, value: 50 },
    })
    .expect(200);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('adelantos al reservar', () => {
  it('sin pagos en línea en el plan, la reserva se confirma sin adelanto', async () => {
    const r = (await book(B, at('09:00')).expect(201)).body;
    expect(r).toMatchObject({ status: 'confirmed', deposit: null });
  });

  it('con adelanto: la cita queda apartada (bloquea el horario) y no se confirma hasta pagar', async () => {
    const r = (await book(A, at('09:00')).expect(201)).body;
    expect(r.status).toBe('awaiting_payment');
    expect(r.deposit).toMatchObject({
      amountCents: 1500,
      status: 'pending',
      payUrl: expect.stringContaining('/v1/public/pay/simulator/'),
    });
    expect(new Date(r.deposit.holdExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    // El horario está tomado mientras se paga.
    const taken = await book(A, at('09:00')).expect(409);
    expect(taken.body.code).toBe('SLOT_TAKEN');
    // Rechazar en la pasarela no confirma; "ya pagué" sin pago tampoco.
    await payLink(r.deposit.payUrl, 'reject');
    expect(
      (
        await request(t.http)
          .post(`/v1/public/appointments/${r.manageToken}/deposit/check`)
          .expect(200)
      ).body.status,
    ).toBe('awaiting_payment');
    // Paga → confirmada, adelanto pagado y sin link.
    await payLink(r.deposit.payUrl);
    const after = await view(r.manageToken);
    expect(after).toMatchObject({ status: 'confirmed', deposit: { status: 'paid', payUrl: null } });
  });

  it('si no paga a tiempo, el worker libera el horario; si paga tarde, el adelanto queda para devolver', async () => {
    const r = (await book(A, at('10:00')).expect(201)).body;
    await owner.query(
      `UPDATE appointment_deposits SET hold_expires_at = now() - interval '1 minute' WHERE appointment_id = $1`,
      [r.id],
    );
    expect(await t.app.get(DepositsService).expireDue()).toBeGreaterThanOrEqual(1);
    expect(await view(r.manageToken)).toMatchObject({
      status: 'canceled',
      deposit: { status: 'expired', payUrl: null },
    });
    // El horario vuelve a estar libre.
    const again = (await book(A, at('10:00')).expect(201)).body;
    expect(again.status).toBe('awaiting_payment');
    // El cliente igual pagó el link viejo (después de vencer): no reabre la cita, se marca para devolver.
    await payLink(r.deposit.payUrl);
    expect((await view(r.manageToken)).deposit.status).toBe('refund_pending');
  });

  it('el cliente puede desistir antes de pagar: se cancela y se libera', async () => {
    const r = (await book(A, at('11:00')).expect(201)).body;
    await request(t.http)
      .post(`/v1/public/appointments/${r.manageToken}/cancel`)
      .send({})
      .expect(200);
    expect(await view(r.manageToken)).toMatchObject({
      status: 'canceled',
      deposit: { status: 'expired' },
    });
    await book(A, at('11:00')).expect(201);
  });

  it('"solo nuevos o que faltaron": un cliente con buen historial no paga adelanto', async () => {
    const o = shop(tokenA, A.slug);
    const rules = (await o.get('/v1/shop/settings/booking-rules').expect(200)).body;
    await o
      .put('/v1/shop/settings/booking-rules', {
        ...rules,
        deposit: { ...rules.deposit, appliesTo: 'new_or_no_show' },
      })
      .expect(200);
    const tel = phone();
    const first = (await book(A, at('12:00'), tel).expect(201)).body; // nuevo → paga
    expect(first.status).toBe('awaiting_payment');
    await payLink(first.deposit.payUrl);
    await owner.query(
      `UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = $1`,
      [first.id],
    );
    const second = (await book(A, at('13:00'), tel).expect(201)).body; // ya vino → sin adelanto
    expect(second).toMatchObject({ status: 'confirmed', deposit: null });
    await o
      .put('/v1/shop/settings/booking-rules', {
        ...rules,
        deposit: { ...rules.deposit, appliesTo: 'all' },
      })
      .expect(200);
  });

  it('excepción por servicio: un servicio exento no pide adelanto', async () => {
    const o = shop(tokenA, A.slug);
    const svc = (
      await o
        .patch(`/v1/shop/services/${A.serviceId}`, {
          depositOverride: { required: false, type: 'percent', value: 0 },
        })
        .expect(200)
    ).body;
    expect(svc.depositOverride).toEqual({ required: false, type: 'percent', value: 0 });
    expect((await book(A, at('14:00')).expect(201)).body).toMatchObject({
      status: 'confirmed',
      deposit: null,
    });
    // Exigir el total solo para este servicio.
    await o
      .patch(`/v1/shop/services/${A.serviceId}`, {
        depositOverride: { required: true, type: 'full', value: 0 },
      })
      .expect(200);
    expect((await book(A, at('15:00')).expect(201)).body.deposit.amountCents).toBe(3000);
    await o.patch(`/v1/shop/services/${A.serviceId}`, { depositOverride: null }).expect(200);
  });

  it('el panel ve la cita apartada en su agenda', async () => {
    const list = await shop(tokenA, A.slug)
      .get(
        `/v1/shop/appointments?from=${encodeURIComponent(`${MON}T00:00:00-05:00`)}&to=${encodeURIComponent(`${MON}T23:59:00-05:00`)}`,
      )
      .expect(200);
    const items = (list.body.items ?? list.body) as Array<{ id: string; status: string }>;
    const held = items.find((x) => x.status === 'awaiting_payment')!;
    expect(held).toBeDefined();
    // La barbería la cancela: el adelanto vence y el horario se libera.
    await shop(tokenA, A.slug)
      .post(`/v1/shop/appointments/${held.id}/status`, { status: 'canceled', reason: 'Prueba' })
      .expect(200);
    const [dep] = (
      await owner.query<{ status: string }>(
        `SELECT status FROM appointment_deposits WHERE appointment_id = $1`,
        [held.id],
      )
    ).rows;
    expect(dep!.status).toBe('expired');
  });
});

describe('adelantos en caja, cancelación, inasistencia y reportes (paso 30)', () => {
  /** Reserva + paga el adelanto (50 % de S/ 30 = S/ 15). Devuelve la cita y su token. */
  async function paidBooking(hhmm: string) {
    const r = (await book(A, at(hhmm)).expect(201)).body;
    await payLink(r.deposit.payUrl);
    const appt = (await shop(tokenA, A.slug).get(`/v1/shop/appointments/${r.id}`).expect(200)).body;
    expect(appt).toMatchObject({
      status: 'confirmed',
      deposit: { amountCents: 1500, status: 'paid', chargeId: expect.any(String) },
    });
    return {
      id: r.id as string,
      token: r.manageToken as string,
      chargeId: appt.deposit.chargeId as string,
    };
  }
  const depositStatus = async (appointmentId: string) =>
    (
      await owner.query<{ status: string }>(
        `SELECT status FROM appointment_deposits WHERE appointment_id = $1`,
        [appointmentId],
      )
    ).rows[0]!.status;

  it('en caja el adelanto entra como pago en línea ya hecho y solo se cobra el resto', async () => {
    const o = shop(tokenA, A.slug);
    await o.post('/v1/shop/cash/open', { openingCents: 0 }).expect(201);
    const b = await paidBooking('16:00');
    const sale = (
      await o
        .post('/v1/shop/sales', {
          appointmentId: b.id,
          items: [{ kind: 'service', serviceId: A.serviceId, staffId: A.staffId }],
          payments: [
            { method: 'online', amountCents: 1500, chargeId: b.chargeId },
            { method: 'cash', amountCents: 1500 },
          ],
        })
        .expect(201)
    ).body;
    expect(sale.payments.map((p: { method: string }) => p.method).sort()).toEqual([
      'cash',
      'online',
    ]);
    expect(await depositStatus(b.id)).toBe('applied');
    // Anular la venta → el adelanto queda para devolver.
    await o.post(`/v1/shop/sales/${sale.id}/void`, { reason: 'Error de cobro' }).expect(200);
    expect(await depositStatus(b.id)).toBe('refund_pending');
  });

  it('si el cliente cancela a tiempo, el adelanto se devuelve', async () => {
    const b = await paidBooking('17:00');
    await request(t.http).post(`/v1/public/appointments/${b.token}/cancel`).send({}).expect(200);
    expect(await depositStatus(b.id)).toBe('refund_pending');
  });

  it('si no se presenta, la barbería lo retiene (o lo devuelve si así lo configuró)', async () => {
    const o = shop(tokenA, A.slug);
    const b = await paidBooking('18:00');
    await o.post(`/v1/shop/appointments/${b.id}/status`, { status: 'no_show' }).expect(200);
    expect(await depositStatus(b.id)).toBe('retained');
    const rules = (await o.get('/v1/shop/settings/booking-rules').expect(200)).body;
    await o
      .put('/v1/shop/settings/booking-rules', {
        ...rules,
        deposit: { ...rules.deposit, retainOnNoShow: false },
      })
      .expect(200);
    const c = await paidBooking('18:30');
    await o.post(`/v1/shop/appointments/${c.id}/status`, { status: 'no_show' }).expect(200);
    expect(await depositStatus(c.id)).toBe('refund_pending');
  });

  it('el reporte del día resume los adelantos cobrados y en qué terminaron', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    const r = (
      await shop(tokenA, A.slug)
        .get(`/v1/shop/reports/overview?from=${today}&to=${today}`)
        .expect(200)
    ).body;
    expect(r.deposits.retainedCents).toBe(1500);
    expect(r.deposits.refundPendingCents).toBeGreaterThanOrEqual(1500 * 3);
    expect(r.deposits.paidCents).toBe(
      r.deposits.appliedCents +
        r.deposits.unusedCents +
        r.deposits.retainedCents +
        r.deposits.refundPendingCents +
        r.deposits.refundedCents,
    );
  });
});

describe('devoluciones por la pasarela (paso 31)', () => {
  const refunds = () => t.app.get(RefundsService);

  it('el worker devuelve los adelantos "por devolver" y quedan devueltos', async () => {
    const pending = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM payment_refunds WHERE barbershop_id = $1 AND status = 'pending'`,
      [A.barbershopId],
    );
    // Cancelación, no-show con devolución, venta anulada y pago tardío (pasos 28–30).
    expect(Number(pending.rows[0]!.n)).toBeGreaterThanOrEqual(4);
    const r = await refunds().processDue(new Date(Date.now() + 1000));
    expect(r.succeeded).toBeGreaterThanOrEqual(4);
    const deps = await owner.query<{ status: string; n: string }>(
      `SELECT status, count(*) AS n FROM appointment_deposits WHERE barbershop_id = $1 GROUP BY status`,
      [A.barbershopId],
    );
    const by = Object.fromEntries(deps.rows.map((d) => [d.status, Number(d.n)]));
    expect(by.refund_pending ?? 0).toBe(0);
    expect(by.refunded).toBeGreaterThanOrEqual(4);
    const list = (
      await shop(tokenA, A.slug).get('/v1/shop/payment-refunds?status=succeeded').expect(200)
    ).body;
    expect(list.items[0]).toMatchObject({
      status: 'succeeded',
      providerRefundId: expect.stringMatching(/^sim_ref_/),
    });
    expect(list.items.some((x: { saleCode: string | null }) => x.saleCode !== null)).toBe(true);
    // El cliente ve que se le devolvió.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    const rep = (
      await shop(tokenA, A.slug)
        .get(`/v1/shop/reports/overview?from=${today}&to=${today}`)
        .expect(200)
    ).body;
    expect(rep.deposits.refundedCents).toBeGreaterThanOrEqual(1500 * 4);
  });

  it('un cobro no se devuelve dos veces; si la pasarela falla se reintenta y luego queda fallida', async () => {
    // Cobro "pagado" sin id de pago en la pasarela → la devolución no puede hacerse.
    const { id: chargeId } = (
      await owner.query<{ id: string }>(
        `INSERT INTO payment_charges (id, barbershop_id, account_id, amount_cents, description, status, expires_at, updated_at)
         SELECT gen_random_uuid(), $1, id, 1000, 'Prueba', 'paid', now(), now() FROM payment_gateway_accounts
         WHERE barbershop_id = $1 AND deleted_at IS NULL LIMIT 1 RETURNING id`,
        [A.barbershopId],
      )
    ).rows[0]!;
    const ins = `INSERT INTO payment_refunds (id, barbershop_id, charge_id, amount_cents, reason, updated_at) VALUES (gen_random_uuid(), $1, $2, 1000, 'Prueba', now())`;
    await owner.query(ins, [A.barbershopId, chargeId]);
    await expect(owner.query(ins, [A.barbershopId, chargeId])).rejects.toThrow(
      /payment_refunds_charge_active_uniq/,
    );
    const { id } = (
      await owner.query<{ id: string }>(`SELECT id FROM payment_refunds WHERE charge_id = $1`, [
        chargeId,
      ])
    ).rows[0]!;
    for (let i = 0; i < 5; i++) {
      await owner.query(`UPDATE payment_refunds SET next_attempt_at = now() WHERE id = $1`, [id]);
      await refunds().processOne(A.barbershopId, id);
    }
    const failed = (
      await shop(tokenA, A.slug).get('/v1/shop/payment-refunds?status=failed').expect(200)
    ).body.items[0];
    expect(failed).toMatchObject({
      id,
      status: 'failed',
      attempts: 5,
      error: expect.stringContaining('id de pago'),
    });
    // Reintentar a mano: vuelve a intentarlo (y vuelve a fallar con el mismo motivo, sin romper nada).
    const retried = (
      await shop(tokenA, A.slug).post(`/v1/shop/payment-refunds/${id}/retry`).expect(200)
    ).body;
    expect(retried).toMatchObject({ status: 'pending', attempts: 1 });
  });
});
