/** Paso 9: notificaciones (cola en message_logs, proveedores, plantillas, webhooks). */
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DispatcherService } from '../../src/modules/notifications/dispatcher.service';
import { twilioSignature } from '../../src/modules/notifications/providers/twilio';
import { HTTP_FETCH } from '../../src/modules/notifications/providers/types';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

// ───────────── fetch falso: registra llamadas y responde lo programado ─────────────
type Call = { url: string; method: string; headers: Record<string, string>; body: string };
const calls: Call[] = [];
const queue: Array<{ match: RegExp; status: number; body: unknown }> = [];
let seq = 0;
const fakeFetch = (url: string, init: RequestInit = {}) => {
  calls.push({
    url,
    method: init.method ?? 'GET',
    headers: (init.headers ?? {}) as Record<string, string>,
    body: typeof init.body === 'string' ? init.body : '',
  });
  const i = queue.findIndex((q) => q.match.test(url));
  const r =
    i >= 0
      ? queue.splice(i, 1)[0]!
      : {
          status: 200,
          body: {
            messages: [{ id: `wamid.${++seq}` }],
            sid: `SM${String(++seq).padStart(32, '0')}`,
            id: `em_${++seq}`,
          },
        };
  return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
};
const respond = (match: RegExp, status: number, body: unknown) =>
  queue.push({ match, status, body });

let t: TestApp;
let owner: Client;
let dispatcher: DispatcherService;

function limaDate(minDays: number, dow: number): string {
  const lima = new Date(Date.now() - 5 * 3600_000);
  for (let i = minDays; i < minDays + 14; i++) {
    const d = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() + i));
    if (d.getUTCDay() === dow) return d.toISOString().slice(0, 10);
  }
  throw new Error('sin fecha');
}
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00-05:00`;

async function setupShop(label: string) {
  const S = await createTenant(owner, label);
  const token = await t.tokenFor(S.ownerUserId);
  const api = {
    get: (u: string) =>
      request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', S.slug),
    post: (u: string, b?: object) =>
      request(t.http)
        .post(u)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', S.slug)
        .send(b),
    put: (u: string, b?: object) =>
      request(t.http)
        .put(u)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', S.slug)
        .send(b),
    delete: (u: string) =>
      request(t.http)
        .delete(u)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-Slug', S.slug),
  };
  await api
    .put(`/v1/shop/locations/${S.locationId}/hours`, {
      days: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        blocks: [{ start: '09:00', end: '19:00' }],
      })),
    })
    .expect(200);
  await api
    .put('/v1/shop/settings/booking-rules', {
      slotIntervalMinutes: 30,
      minNoticeMinutes: 60,
      maxAdvanceDays: 30,
    })
    .expect(200);
  return { S, api };
}

const book = (
  S: TenantFixture,
  start: string,
  customer: object = { fullName: 'María Pérez', phone: '987654321', email: 'maria@mail.pe' },
) =>
  request(t.http)
    .post(`/v1/public/shops/${S.slug}/appointments`)
    .send({ serviceIds: [S.serviceId], staffId: S.staffId, startAt: start, customer })
    .expect(201);

const logsOf = async (appointmentId: string) =>
  (
    await owner.query(
      `SELECT event, channel, status, recipient_kind, "to", scheduled_for, body, provider, provider_message_id, error, action_url, attempts FROM message_logs WHERE appointment_id = $1 ORDER BY event, channel, scheduled_for`,
      [appointmentId],
    )
  ).rows;

/** Procesa la cola hasta vaciar lo vencido (incluye mensajes de otras suites: el worker es global). */
async function drain(now = new Date()) {
  for (let i = 0; i < 50; i++) if ((await dispatcher.processBatch(50, now)).claimed === 0) break;
}

beforeAll(async () => {
  t = await createTestApp([], [{ provide: HTTP_FETCH, useValue: fakeFetch }]);
  dispatcher = t.app.get(DispatcherService);
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  await drain(); // lo que hayan dejado otras suites
});
beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
});
afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('encolado en la misma transacción que la cita', () => {
  it('reserva online: confirmación por WhatsApp y email, recordatorio a 24 h y aviso al barbero', async () => {
    const { S } = await setupShop('nq1');
    const d = limaDate(7, 1);
    const appt = (await book(S, at(d, '10:00'))).body;
    const logs = await logsOf(appt.id);
    expect(logs.map((l) => `${l.event}/${l.channel}/${l.recipient_kind}`).sort()).toEqual([
      'booking_confirmed/email/customer',
      'booking_confirmed/whatsapp/customer',
      'reminder/whatsapp/customer',
      'staff_new_booking/email/staff',
    ]);
    const reminder = logs.find((l) => l.event === 'reminder')!;
    expect(new Date(reminder.scheduled_for).toISOString()).toBe(
      new Date(new Date(at(d, '10:00')).getTime() - 24 * 3600_000).toISOString(),
    );
    expect(reminder.to).toBe('+51987654321');
    expect(logs.every((l) => l.status === 'queued')).toBe(true);
  });

  it('reprogramar rehace los recordatorios; cancelar los elimina', async () => {
    const { S } = await setupShop('nq2');
    const d = limaDate(7, 2);
    const appt = (await book(S, at(d, '10:00'))).body;
    await request(t.http)
      .post(`/v1/public/appointments/${appt.manageToken}/reschedule`)
      .send({ startAt: at(d, '15:00') })
      .expect(200);
    let logs = await logsOf(appt.id);
    const reminders = logs.filter((l) => l.event === 'reminder');
    expect(reminders).toHaveLength(1);
    expect(new Date(reminders[0]!.scheduled_for).toISOString()).toBe(
      new Date(new Date(at(d, '15:00')).getTime() - 24 * 3600_000).toISOString(),
    );
    expect(
      logs
        .filter((l) => l.event === 'rescheduled')
        .map((l) => l.channel)
        .sort(),
    ).toEqual(['email', 'whatsapp']);

    await request(t.http)
      .post(`/v1/public/appointments/${appt.manageToken}/cancel`)
      .send({})
      .expect(200);
    logs = await logsOf(appt.id);
    expect(logs.filter((l) => l.event === 'reminder')).toEqual([]);
    expect(logs.filter((l) => l.event === 'canceled')).toHaveLength(2);
  });

  it('aprobación manual: "solicitud recibida", y al confirmar desde el panel llega la confirmación + recordatorio', async () => {
    const { S, api } = await setupShop('nq3');
    await api
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 30,
        minNoticeMinutes: 60,
        approvalMode: 'manual',
      })
      .expect(200);
    const d = limaDate(7, 3);
    const appt = (await book(S, at(d, '11:00'))).body;
    expect(
      (await logsOf(appt.id)).map((l) => l.event).filter((e) => e !== 'staff_new_booking'),
    ).toEqual(['booking_requested', 'booking_requested']);
    await api.post(`/v1/shop/appointments/${appt.id}/status`, { status: 'confirmed' }).expect(200);
    const events = (await logsOf(appt.id)).map((l) => l.event);
    expect(events.filter((e) => e === 'booking_confirmed')).toHaveLength(2);
    expect(events).toContain('reminder');
  });

  it('desde el panel: sin aviso al barbero; walk-in: ningún mensaje; preferencias por evento y varios recordatorios', async () => {
    const { S, api } = await setupShop('nq4');
    await api
      .put('/v1/shop/settings/notifications', {
        events: { booking_confirmed: { whatsapp: true, email: false } },
        reminderHours: [24, 2],
      })
      .expect(200);
    const d = limaDate(7, 4);
    const phone = await api
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d, '10:00'),
        source: 'phone',
        customer: { fullName: 'Por Teléfono', phone: '911222333', email: 'tel@mail.pe' },
      })
      .expect(201);
    const logs = await logsOf(phone.body.id);
    expect(logs.map((l) => `${l.event}/${l.channel}`)).toEqual([
      'booking_confirmed/whatsapp',
      'reminder/whatsapp',
      'reminder/whatsapp',
    ]);

    const walkin = await api
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        source: 'walk_in',
        status: 'in_progress',
        customer: { fullName: 'De Paso', phone: '911222444' },
      })
      .expect(201);
    expect(await logsOf(walkin.body.id)).toEqual([]);
  });

  it('si la cita no se crea (horario ocupado), tampoco hay mensajes', async () => {
    const { S } = await setupShop('nq5');
    const d = limaDate(7, 5);
    await book(S, at(d, '10:00'));
    const before = (
      await owner.query(`SELECT count(*)::int AS n FROM message_logs WHERE barbershop_id = $1`, [
        S.barbershopId,
      ])
    ).rows[0].n;
    await request(t.http)
      .post(`/v1/public/shops/${S.slug}/appointments`)
      .send({
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d, '10:00'),
        customer: { fullName: 'Otro', phone: '955000111' },
      })
      .expect(409);
    expect(
      (
        await owner.query(`SELECT count(*)::int AS n FROM message_logs WHERE barbershop_id = $1`, [
          S.barbershopId,
        ])
      ).rows[0].n,
    ).toBe(before);
  });
});

describe('worker (dispatcher)', () => {
  it('envía lo vencido con el número de la plataforma (consola en local) y renderiza la plantilla; los recordatorios futuros esperan', async () => {
    const { S } = await setupShop('nw1');
    const d = limaDate(7, 1);
    const appt = (
      await book(S, at(d, '10:30'), {
        fullName: 'Lucía Ramos',
        phone: '987000111',
        email: 'lucia@mail.pe',
      })
    ).body;
    await drain();
    const logs = await logsOf(appt.id);
    const wa = logs.find((l) => l.event === 'booking_confirmed' && l.channel === 'whatsapp')!;
    expect(wa).toMatchObject({ status: 'sent', provider: 'whatsapp:platform' });
    expect(wa.body).toContain('¡Listo Lucía!');
    expect(wa.body).toMatch(/10:30/);
    expect(wa.body).toContain(`/b/${S.slug}/cita/${appt.manageToken}`);
    const email = logs.find((l) => l.event === 'booking_confirmed' && l.channel === 'email')!;
    expect(email).toMatchObject({ status: 'sent', provider: 'email' });
    expect(email.body).toContain('S/');
    expect(logs.find((l) => l.event === 'reminder')!.status).toBe('queued');

    // Llegado el momento del recordatorio, sale.
    await drain(new Date(new Date(at(d, '10:30')).getTime() - 23 * 3600_000));
    expect((await logsOf(appt.id)).find((l) => l.event === 'reminder')!.status).toBe('sent');
  });

  it('WhatsApp Cloud API: credenciales cifradas, verificación, envío real (fake) y reintentos con backoff', async () => {
    const { S, api } = await setupShop('nw2');
    const creds = {
      phoneNumberId: '1234567890',
      wabaId: '9876543210',
      accessToken: 'EAAG-super-secreto-de-prueba-123',
    };
    const put = await api
      .put('/v1/shop/whatsapp', { provider: 'cloud_api', cloudApi: creds })
      .expect(200);
    expect(put.body).toMatchObject({
      provider: 'cloud_api',
      status: 'unverified',
      hasCredentials: true,
      publicFields: { phoneNumberId: '1234567890', wabaId: '9876543210' },
    });
    expect(JSON.stringify(put.body)).not.toContain('super-secreto');
    const raw = (
      await owner.query(`SELECT credentials_enc FROM whatsapp_configs WHERE barbershop_id = $1`, [
        S.barbershopId,
      ])
    ).rows[0].credentials_enc as Buffer;
    expect(raw.toString('latin1')).not.toContain('super-secreto');

    respond(/1234567890\?fields/, 200, {
      display_phone_number: '+51 1 700 0000',
      verified_name: 'Barbería NW2',
    });
    const ver = await api.post('/v1/shop/whatsapp/verify').expect(200);
    expect(ver.body).toMatchObject({ status: 'ok', displayPhone: '+51 1 700 0000' });
    expect(
      (await api.get('/v1/shop/onboarding').expect(200)).body.steps.find(
        (s: { key: string }) => s.key === 'whatsapp',
      ).done,
    ).toBe(true);

    const d = limaDate(7, 2);
    const appt = (await book(S, at(d, '12:00'), { fullName: 'Pepe', phone: '987000222' })).body; // sin email
    // 1º intento: Meta caído (503) → se reintenta en 1 minuto.
    respond(/graph\.facebook\.com\/.*\/1234567890\/messages/, 503, {
      error: { message: 'Service unavailable' },
    });
    const now = new Date();
    await drain(now);
    let wa = (await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')!;
    expect(wa).toMatchObject({ status: 'queued', attempts: 1, error: 'Service unavailable' });
    expect(new Date(wa.scheduled_for).getTime() - now.getTime()).toBe(60_000);

    await drain(new Date(now.getTime() + 61_000));
    wa = (await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')!;
    expect(wa).toMatchObject({ status: 'sent', provider: 'cloud_api', attempts: 2 });
    expect(wa.provider_message_id).toMatch(/^wamid\./);
    const sent = calls.filter((c) => c.url.endsWith('/1234567890/messages')).at(-1)!;
    expect(sent.headers.authorization).toBe(`Bearer ${creds.accessToken}`);
    expect(JSON.parse(sent.body)).toMatchObject({ to: '51987000222', type: 'text' });
  });

  it('error no recuperable (4xx) → falla sin reintentar; se puede reintentar a mano', async () => {
    const { S, api } = await setupShop('nw3');
    await api
      .put('/v1/shop/whatsapp', {
        provider: 'cloud_api',
        cloudApi: {
          phoneNumberId: '1111122222',
          wabaId: '3333344444',
          accessToken: 'EAAG-token-de-prueba-xxxxxxx',
        },
      })
      .expect(200);
    const appt = (
      await book(S, at(limaDate(7, 3), '12:00'), { fullName: 'Fallo', phone: '987000333' })
    ).body;
    respond(/1111122222\/messages/, 400, {
      error: { message: '(#131047) Re-engagement message', code: 131047 },
    });
    await drain();
    const wa = (await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')!;
    expect(wa).toMatchObject({ status: 'failed', attempts: 1 });
    expect(wa.error).toContain('131047');

    const id = (
      await owner.query(
        `SELECT id FROM message_logs WHERE appointment_id = $1 AND event = 'booking_confirmed'`,
        [appt.id],
      )
    ).rows[0].id;
    await api.post(`/v1/shop/message-logs/${id}/retry`).expect(200);
    await drain();
    expect((await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')!.status).toBe(
      'sent',
    );
  });

  it('wa.me: el mensaje queda "manual" con el enlace prellenado y se marca enviado desde el panel', async () => {
    const { S, api } = await setupShop('nw4');
    await api.put('/v1/shop/whatsapp', { provider: 'wa_me' }).expect(200);
    const appt = (
      await book(S, at(limaDate(7, 4), '12:00'), { fullName: 'Manual', phone: '987000444' })
    ).body;
    await drain();
    const wa = (await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')!;
    expect(wa.status).toBe('manual');
    expect(wa.action_url).toMatch(/^https:\/\/wa\.me\/51987000444\?text=/);
    const list = await api.get('/v1/shop/message-logs?status=manual').expect(200);
    expect(list.body.items).toHaveLength(1);
    await api.post(`/v1/shop/message-logs/${list.body.items[0].id}/mark-sent`).expect(200);
    await api.post(`/v1/shop/message-logs/${list.body.items[0].id}/mark-sent`).expect(409);
  });

  it('límite mensual de WhatsApp del plan', async () => {
    const { S, api } = await setupShop('nw5');
    const planId = randomUUID();
    await owner.query(
      `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, updated_at) VALUES ($1, $2, 'W', 0, 0, '{"whatsappPerMonth": 1}', now())`,
      [planId, `w-${planId.slice(0, 8)}`],
    );
    await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
      planId,
      S.barbershopId,
    ]);
    const d = limaDate(7, 5);
    const a1 = (await book(S, at(d, '10:00'), { fullName: 'Uno', phone: '987000551' })).body;
    const a2 = (await book(S, at(d, '11:00'), { fullName: 'Dos', phone: '987000552' })).body;
    await drain();
    const s1 = (await logsOf(a1.id)).find(
      (l) => l.event === 'booking_confirmed' && l.channel === 'whatsapp',
    )!.status;
    const l2 = (await logsOf(a2.id)).find(
      (l) => l.event === 'booking_confirmed' && l.channel === 'whatsapp',
    )!;
    expect(s1).toBe('sent');
    expect(l2).toMatchObject({ status: 'failed' });
    expect(l2.error).toContain('PLAN_LIMIT_REACHED');
    const usage = await api.get('/v1/shop/notifications/usage').expect(200);
    expect(usage.body.whatsapp).toMatchObject({ used: 1, limit: 1 });
  });

  it('un worker que murió con mensajes "sending" se recupera', async () => {
    const { S } = await setupShop('nw6');
    const appt = (
      await book(S, at(limaDate(7, 6), '10:00'), { fullName: 'Zombi', phone: '987000666' })
    ).body;
    await owner.query(
      `UPDATE message_logs SET status = 'sending', locked_at = now() - interval '10 minutes' WHERE appointment_id = $1 AND event = 'booking_confirmed'`,
      [appt.id],
    );
    await drain();
    expect((await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')!.status).toBe(
      'sent',
    );
  });

  it('un recordatorio de una cita cancelada fuera de la cola no se envía', async () => {
    const { S } = await setupShop('nw7');
    const d = limaDate(7, 1);
    const appt = (await book(S, at(d, '16:00'), { fullName: 'Cancelada', phone: '987000777' }))
      .body;
    await owner.query(`UPDATE appointments SET status = 'canceled' WHERE id = $1`, [appt.id]); // sin pasar por la API
    await drain(new Date(new Date(at(d, '16:00')).getTime() - 23 * 3600_000));
    const r = (await logsOf(appt.id)).find((l) => l.event === 'reminder')!;
    expect(r.status).toBe('failed');
    expect(r.error).toContain('canceled');
  });
});

describe('plantillas', () => {
  it('lista, valida variables, personaliza (se usa al enviar), previsualiza y vuelve al default', async () => {
    const { S, api } = await setupShop('nt1');
    const list = await api.get('/v1/shop/message-templates').expect(200);
    expect(list.body.templates).toHaveLength(12);
    expect(list.body.variables).toContain('link_cancelar');

    const bad = await api
      .put('/v1/shop/message-templates/booking_confirmed/whatsapp', { body: 'Hola {{nombre}}' })
      .expect(400);
    expect(bad.body.title).toContain('{{nombre}}');
    await api
      .put('/v1/shop/message-templates/booking_confirmed/email', { body: 'Sin asunto {{cliente}}' })
      .expect(400);

    const custom = await api
      .put('/v1/shop/message-templates/booking_confirmed/whatsapp', {
        body: '💈 {{cliente}}, te esperamos el {{fecha}} a las {{hora}}. ¡Gracias!',
      })
      .expect(200);
    expect(custom.body.source).toBe('custom');
    const prev = await api
      .post('/v1/shop/message-templates/preview', {
        event: 'booking_confirmed',
        channel: 'whatsapp',
      })
      .expect(200);
    expect(prev.body.body).toBe(
      '💈 Ana, te esperamos el lunes, 10 de noviembre a las 10:30 a. m.. ¡Gracias!',
    );

    const appt = (
      await book(S, at(limaDate(7, 2), '09:00'), { fullName: 'Rosa Díaz', phone: '987000881' })
    ).body;
    await drain();
    expect(
      (await logsOf(appt.id)).find(
        (l) => l.event === 'booking_confirmed' && l.channel === 'whatsapp',
      )!.body,
    ).toMatch(/^💈 Rosa, te esperamos el /);

    await api.delete('/v1/shop/message-templates/booking_confirmed/whatsapp').expect(204);
    const after = (await api.get('/v1/shop/message-templates').expect(200)).body.templates.find(
      (x: { event: string; channel: string }) =>
        x.event === 'booking_confirmed' && x.channel === 'whatsapp',
    );
    expect(after.source).toBe('default');
  });

  it('enviar a aprobación de Meta exige Cloud API verificado; usa parámetros posicionales', async () => {
    const { api } = await setupShop('nt2');
    await api.post('/v1/shop/message-templates/reminder/whatsapp/submit').expect(409);
    await api
      .put('/v1/shop/whatsapp', {
        provider: 'cloud_api',
        cloudApi: {
          phoneNumberId: '5555566666',
          wabaId: '7777788888',
          accessToken: 'EAAG-token-de-prueba-yyyyyyy',
        },
      })
      .expect(200);
    respond(/5555566666\?fields/, 200, { display_phone_number: '+51 1 800 0000' });
    await api.post('/v1/shop/whatsapp/verify').expect(200);
    respond(/7777788888\/message_templates/, 200, { id: 'tpl_1', status: 'PENDING' });
    const res = await api.post('/v1/shop/message-templates/reminder/whatsapp/submit').expect(200);
    expect(res.body).toMatchObject({
      providerStatus: 'pending',
      providerTemplateName: expect.stringMatching(/^bs_reminder_[0-9a-f]{8}$/),
    });
    const sent = JSON.parse(calls.find((c) => c.url.endsWith('/message_templates'))!.body);
    expect(sent.components[0].text).toContain('{{1}}');
    expect(sent.components[0].text).not.toContain('{{cliente}}');
    expect(sent.category).toBe('UTILITY');
  });
});

describe('webhooks', () => {
  const sign = (body: string) =>
    `sha256=${createHmac('sha256', 'test-meta-app-secret').update(body).digest('hex')}`;
  const meta = (payload: object, signature?: string) => {
    const body = JSON.stringify(payload);
    return request(t.http)
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature ?? sign(body))
      .send(body);
  };
  const status = (id: string, s: string, ts: number) => ({
    entry: [
      {
        changes: [
          { field: 'messages', value: { statuses: [{ id, status: s, timestamp: String(ts) }] } },
        ],
      },
    ],
  });

  it('verificación de suscripción (hub.challenge)', async () => {
    const ok = await request(t.http)
      .get(
        '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345',
      )
      .expect(200);
    expect(ok.text).toBe('12345');
    await request(t.http)
      .get('/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1')
      .expect(403);
  });

  it('estados firmados, idempotentes y sin retroceder aunque lleguen desordenados', async () => {
    const { S, api } = await setupShop('nh1');
    await api
      .put('/v1/shop/whatsapp', {
        provider: 'cloud_api',
        cloudApi: {
          phoneNumberId: '2222233333',
          wabaId: '4444455555',
          accessToken: 'EAAG-token-de-prueba-zzzzzzz',
        },
      })
      .expect(200);
    await book(S, at(limaDate(7, 3), '10:00'), { fullName: 'Webhook', phone: '987000991' });
    respond(/2222233333\/messages/, 200, { messages: [{ id: 'wamid.HOOK1' }] });
    await drain();
    const ts = Math.floor(Date.now() / 1000);

    await meta(status('wamid.HOOK1', 'read', ts + 20)).expect(200);
    await meta(status('wamid.HOOK1', 'delivered', ts + 10)).expect(200); // llega tarde
    await meta(status('wamid.HOOK1', 'read', ts + 20)).expect(200); // repetido
    await meta(status('wamid.HOOK1', 'failed', ts + 30)).expect(200); // tras "leído" no se marca fallido
    const row = (
      await owner.query(
        `SELECT status, read_at FROM message_logs WHERE provider_message_id = 'wamid.HOOK1'`,
      )
    ).rows[0];
    expect(row.status).toBe('read');
    expect(new Date(row.read_at).getTime()).toBe((ts + 20) * 1000);

    await meta(status('wamid.HOOK1', 'delivered', ts), 'sha256=deadbeef').expect(403);
    await meta(status('wamid.DESCONOCIDO', 'read', ts)).expect(200);
  });

  it('aprobación de plantilla por webhook', async () => {
    const { S } = await setupShop('nh2');
    // La fixture ya trae una plantilla reminder/whatsapp propia: se marca como enviada a Meta.
    await owner.query(
      `UPDATE message_templates SET provider_template_name = 'bs_reminder_test1234', provider_status = 'pending' WHERE barbershop_id = $1 AND event = 'reminder' AND channel = 'whatsapp'`,
      [S.barbershopId],
    );
    await meta({
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_name: 'bs_reminder_test1234' },
            },
          ],
        },
      ],
    }).expect(200);
    expect(
      (
        await owner.query(
          `SELECT provider_status FROM message_templates WHERE provider_template_name = 'bs_reminder_test1234'`,
        )
      ).rows[0].provider_status,
    ).toBe('approved');
  });

  it('Twilio: firma con el token de esa barbería', async () => {
    const { S, api } = await setupShop('nh3');
    const twilio = {
      accountSid: `AC${'a'.repeat(32)}`,
      authToken: 'twilio-auth-token-123456',
      fromNumber: '+14155550100',
    };
    await api.put('/v1/shop/whatsapp', { provider: 'twilio', twilio }).expect(200);
    const appt = (
      await book(S, at(limaDate(7, 4), '10:00'), { fullName: 'Twilio', phone: '987000992' })
    ).body;
    respond(/api\.twilio\.com/, 201, { sid: 'SMtest0000000000000000000000000001' });
    await drain();
    expect((await logsOf(appt.id)).find((l) => l.event === 'booking_confirmed')).toMatchObject({
      status: 'sent',
      provider: 'twilio',
    });

    const params = { MessageSid: 'SMtest0000000000000000000000000001', MessageStatus: 'delivered' };
    const url = 'http://localhost:3100/v1/webhooks/twilio';
    await request(t.http)
      .post('/v1/webhooks/twilio')
      .type('form')
      .set('X-Twilio-Signature', 'firma-falsa')
      .send(params)
      .expect(403);
    await request(t.http)
      .post('/v1/webhooks/twilio')
      .type('form')
      .set('X-Twilio-Signature', twilioSignature(twilio.authToken, url, params))
      .send(params)
      .expect(200);
    expect(
      (
        await owner.query(`SELECT status FROM message_logs WHERE provider_message_id = $1`, [
          params.MessageSid,
        ])
      ).rows[0].status,
    ).toBe('delivered');
  });
});
