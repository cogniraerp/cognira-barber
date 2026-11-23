/** Paso 7: disponibilidad, reserva pública, anti doble reserva y agenda del panel. */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let S: TenantFixture;
let ownerToken: string;
let beto: string; // segundo barbero
let barba: string; // segundo servicio
let barberUser: { token: string; staffId: string };

/** Fecha local de Lima (UTC−5) a `days` días de hoy, que caiga en el día de semana `dow`. */
function limaDate(minDays: number, dow?: number): string {
  const lima = new Date(Date.now() - 5 * 3600_000);
  for (let i = minDays; i < minDays + 14; i++) {
    const d = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate() + i));
    if (dow === undefined ? d.getUTCDay() !== 0 : d.getUTCDay() === dow)
      return d.toISOString().slice(0, 10);
  }
  throw new Error('sin fecha');
}
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00-05:00`;
const iso = (date: string, hhmm: string) => new Date(at(date, hhmm)).toISOString();

const MON = () => limaDate(7, 1); // lunes, 7–13 días adelante (dentro de maxAdvance 30)
const SUN = () => limaDate(7, 0);

const pub = {
  shop: (slug = S.slug) => request(t.http).get(`/v1/public/shops/${slug}`),
  availability: (q: string, slug = S.slug) =>
    request(t.http).get(`/v1/public/shops/${slug}/availability?${q}`),
  book: (body: object, slug = S.slug) =>
    request(t.http).post(`/v1/public/shops/${slug}/appointments`).send(body),
};
const shopApi = (token: string) => ({
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
  patch: (u: string, b?: object) =>
    request(t.http)
      .patch(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', S.slug)
      .send(b),
});

const customer = (n = randomUUID().slice(0, 6)) => ({
  fullName: `Cliente ${n}`,
  phone: `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
});
const slotsOf = (
  body: { days: Array<{ date: string; slots: Array<{ start: string; staffIds?: string[] }> }> },
  date: string,
) => body.days.find((d) => d.date === date)?.slots ?? [];

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  S = await createTenant(owner, 'book');
  ownerToken = await t.tokenFor(S.ownerUserId);
  const o = shopApi(ownerToken);

  // Lunes a sábado 09–13 y 15–19.
  await o
    .put(`/v1/shop/locations/${S.locationId}/hours`, {
      days: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        blocks: [
          { start: '09:00', end: '13:00' },
          { start: '15:00', end: '19:00' },
        ],
      })),
    })
    .expect(200);
  beto = (await o.post('/v1/shop/staff', { displayName: 'Beto' }).expect(201)).body.id;
  barba = (
    await o
      .post('/v1/shop/services', {
        name: 'Barba',
        priceCents: 2000,
        durationMin: 20,
        bufferAfterMin: 10,
        staffIds: [S.staffId, beto],
      })
      .expect(201)
  ).body.id;
  // "Corte" (fixture, 30 min, S/30): Beto cobra S/40 y tarda 45.
  await o
    .put(`/v1/shop/staff/${beto}/services`, {
      items: [
        { serviceId: S.serviceId, priceCentsOverride: 4000, durationMinOverride: 45 },
        { serviceId: barba },
      ],
    })
    .expect(200);
  await o
    .put('/v1/shop/settings/booking-rules', {
      slotIntervalMinutes: 15,
      minNoticeMinutes: 60,
      maxAdvanceDays: 30,
      cancellationWindowHours: 2,
    })
    .expect(200);

  // Usuario barbero vinculado a Beto (permisos de "solo lo suyo").
  const userId = randomUUID();
  const membershipId = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Beto', now())`,
    [userId, `beto-${userId}@test.pe`],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [membershipId, S.barbershopId, userId],
  );
  await owner.query(`UPDATE staff SET membership_id = $1 WHERE id = $2`, [membershipId, beto]);
  barberUser = { token: await t.tokenFor(userId), staffId: beto };
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('página pública', () => {
  it('devuelve marca, horario, servicios con rango de precio y barberos', async () => {
    const res = await pub.shop().expect(200);
    expect(res.headers['cache-control']).toContain('max-age=60');
    expect(res.body).toMatchObject({
      slug: S.slug,
      timezone: 'America/Lima',
      currency: 'PEN',
      booking: { allowStaffSelection: true, minNoticeMinutes: 60 },
    });
    const corte = res.body.services.find((s: { id: string }) => s.id === S.serviceId);
    expect(corte).toMatchObject({ priceFromCents: 3000, priceToCents: 4000 });
    expect(res.body.staff.map((s: { displayName: string }) => s.displayName)).toEqual(
      expect.arrayContaining(['Barbero', 'Beto']),
    );
    expect(res.body.locations[0].hours[1].blocks).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '15:00', end: '19:00' },
    ]);
  });

  it('una barbería en onboarding, suspendida o inexistente no es pública', async () => {
    const O = await createTenant(owner, 'onbpub');
    await owner.query(`UPDATE barbershops SET status = 'onboarding' WHERE id = $1`, [
      O.barbershopId,
    ]);
    await pub.shop(O.slug).expect(404);
    await pub.shop('no-existe-nunca').expect(404);
    await pub.shop('../../etc').expect(404);
  });
});

describe('disponibilidad pública', () => {
  it('lunes con bloques partidos; domingo cerrado; la duración depende del barbero', async () => {
    const d = MON();
    const res = await pub.availability(`serviceIds=${S.serviceId}&from=${d}&to=${d}`).expect(200);
    const slots = slotsOf(res.body, d);
    expect(slots[0]!.start).toBe(iso(d, '09:00'));
    const at1230 = slots.find((s) => s.start === iso(d, '12:30'))!;
    // A las 12:30 solo cabe el barbero de 30 min (Beto tarda 45 y el bloque cierra a las 13:00).
    expect(at1230.staffIds).toEqual([S.staffId]);
    expect(slots.some((s) => s.start === iso(d, '13:00'))).toBe(false);
    expect(res.body.staff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ staffId: beto, durationMin: 45, priceCents: 4000 }),
      ]),
    );

    const sun = await pub
      .availability(`serviceIds=${S.serviceId}&from=${SUN()}&to=${SUN()}`)
      .expect(200);
    expect(sun.body.days).toEqual([]);
  });

  it('varios servicios suman duración; un barbero concreto filtra', async () => {
    const d = MON();
    const res = await pub
      .availability(
        `serviceIds=${S.serviceId}&serviceIds=${barba}&staffId=${S.staffId}&from=${d}&to=${d}`,
      )
      .expect(200);
    const starts = slotsOf(res.body, d).map((s) => s.start);
    // 30 + 20 = 50 min (+10 de buffer posterior, que sí puede caer al cierre): 12:00 entra, 12:15 no.
    expect(starts).toContain(iso(d, '12:00'));
    expect(starts).not.toContain(iso(d, '12:15'));
  });

  it('valida el rango y los servicios', async () => {
    const d = MON();
    const far = new Date(new Date(`${d}T00:00:00Z`).getTime() + 40 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await pub.availability(`serviceIds=${S.serviceId}&from=${d}&to=${far}`).expect(400);
    await pub.availability(`serviceIds=${randomUUID()}&from=${d}&to=${d}`).expect(400);
    await pub.availability(`serviceIds=no-uuid&from=${d}&to=${d}`).expect(400);
  });
});

describe('reservar', () => {
  it('crea la cita confirmada, normaliza el teléfono y devuelve el enlace de gestión', async () => {
    const d = MON();
    const c = customer();
    const res = await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: beto,
        startAt: at(d, '09:00'),
        customer: { ...c, phone: `+51 ${c.phone}` },
      })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'confirmed',
      startAt: iso(d, '09:00'),
      endAt: iso(d, '09:45'), // Beto tarda 45
      totalCents: 4000,
      staff: { id: beto, displayName: 'Beto' },
      shop: { slug: S.slug },
      canCancel: true,
    });
    expect(res.body.manageUrl).toBe(
      `http://localhost:5173/b/${S.slug}/cita/${res.body.manageToken}`,
    );
    const { rows } = await owner.query(
      `SELECT phone_e164 FROM customers WHERE barbershop_id = $1 AND full_name = $2`,
      [S.barbershopId, c.fullName],
    );
    expect(rows[0].phone_e164).toBe(`+51${c.phone}`);
  });

  it('el mismo horario con el mismo barbero → 409 SLOT_TAKEN con alternativas', async () => {
    const d = MON();
    const res = await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: beto,
        startAt: at(d, '09:00'),
        customer: customer(),
      })
      .expect(409);
    expect(res.body.code).toBe('SLOT_TAKEN');
    expect(res.body.alternatives.length).toBeGreaterThan(0);
    expect(res.body.alternatives).not.toContain(iso(d, '09:00'));
  });

  it('"cualquier barbero" asigna al que queda libre; luego ya no hay nadie', async () => {
    const d = MON();
    const any = await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: null,
        startAt: at(d, '09:00'),
        customer: customer(),
      })
      .expect(201);
    expect(any.body.staff.id).toBe(S.staffId);
    await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: null,
        startAt: at(d, '09:00'),
        customer: customer(),
      })
      .expect(409);
  });

  it('respeta el buffer: una cita a las 09:30 con el otro barbero choca con su "Barba" + 10 min', async () => {
    const d = MON();
    // Barbero (fixture) ya tiene 09:00–09:30 (corte). Barba de 09:30 a 09:50 + 10 de buffer → bloquea hasta 10:00.
    await pub
      .book({
        serviceIds: [barba],
        staffId: S.staffId,
        startAt: at(d, '09:30'),
        customer: customer(),
      })
      .expect(201);
    const res = await pub
      .availability(`serviceIds=${S.serviceId}&staffId=${S.staffId}&from=${d}&to=${d}`)
      .expect(200);
    const starts = slotsOf(res.body, d).map((s) => s.start);
    expect(starts).not.toContain(iso(d, '09:45'));
    expect(starts).toContain(iso(d, '10:00'));
  });

  it('fuera de la grilla, fuera de horario o con poca anticipación → no se puede', async () => {
    const d = MON();
    await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: beto,
        startAt: at(d, '10:07'),
        customer: customer(),
      })
      .expect(409);
    await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: beto,
        startAt: at(d, '13:30'),
        customer: customer(),
      })
      .expect(409);
    await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: beto,
        startAt: at(SUN(), '10:00'),
        customer: customer(),
      })
      .expect(409);
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    await pub
      .book({ serviceIds: [S.serviceId], staffId: beto, startAt: soon, customer: customer() })
      .expect(409);
  });

  it('datos del cliente, campos personalizados y honeypot', async () => {
    const d = MON();
    const base = { serviceIds: [S.serviceId], staffId: beto, startAt: at(d, '16:00') };
    const noPhone = await pub.book({ ...base, customer: { fullName: 'Sin Teléfono' } }).expect(400);
    expect(noPhone.body.errors[0].path).toBe('customer.phone');
    await pub.book({ ...base, customer: { fullName: 'Tel Malo', phone: '12' } }).expect(400);
    await pub.book({ ...base, customer: customer(), website: 'http://spam' }).expect(400);

    await shopApi(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        cancellationWindowHours: 2,
        customFields: [
          {
            key: 'estilo',
            label: 'Estilo',
            type: 'select',
            required: true,
            options: ['Clásico', 'Fade'],
          },
        ],
      })
      .expect(200);
    const missing = await pub.book({ ...base, customer: customer() }).expect(400);
    expect(missing.body.errors[0].path).toBe('customFields.estilo');
    await pub
      .book({ ...base, customer: customer(), customFields: { estilo: 'Mohicano' } })
      .expect(400);
    await pub
      .book({ ...base, customer: customer(), customFields: { otro: 'x', estilo: 'Fade' } })
      .expect(400);
    const ok = await pub
      .book({ ...base, customer: customer(), customFields: { estilo: 'Fade' } })
      .expect(201);
    const { rows } = await owner.query(`SELECT custom_fields FROM appointments WHERE id = $1`, [
      ok.body.id,
    ]);
    expect(rows[0].custom_fields).toEqual({ estilo: 'Fade' });
    await shopApi(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        cancellationWindowHours: 2,
      })
      .expect(200);
  });

  it('cliente bloqueado → 403; máximo de reservas activas → 409', async () => {
    const d = MON();
    const c = customer();
    await pub
      .book({ serviceIds: [barba], staffId: beto, startAt: at(d, '17:00'), customer: c })
      .expect(201);
    await owner.query(
      `UPDATE customers SET is_blocked = true WHERE barbershop_id = $1 AND phone_e164 = $2`,
      [S.barbershopId, `+51${c.phone}`],
    );
    await pub
      .book({ serviceIds: [barba], staffId: beto, startAt: at(d, '17:30'), customer: c })
      .expect(403);

    const c2 = customer();
    for (const h of ['15:00', '15:30', '18:00'])
      await pub
        .book({ serviceIds: [barba], staffId: S.staffId, startAt: at(d, h), customer: c2 })
        .expect(201);
    const max = await pub
      .book({ serviceIds: [barba], staffId: S.staffId, startAt: at(d, '18:30'), customer: c2 })
      .expect(409);
    expect(max.body.title).toContain('máximo es 3');
  });

  it('aprobación manual → la cita queda pendiente (pero ya ocupa el horario)', async () => {
    const d = limaDate(8, 2); // martes
    await shopApi(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        approvalMode: 'manual',
      })
      .expect(200);
    const res = await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d, '10:00'),
        customer: customer(),
      })
      .expect(201);
    expect(res.body.status).toBe('pending');
    await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d, '10:00'),
        customer: customer(),
      })
      .expect(409);
    await shopApi(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        cancellationWindowHours: 2,
      })
      .expect(200);
  });
});

describe('concurrencia (doble reserva)', () => {
  it('6 reservas simultáneas al mismo barbero y hora → exactamente 1 gana', async () => {
    const d = limaDate(9, 3); // miércoles
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        pub.book({
          serviceIds: [S.serviceId],
          staffId: beto,
          startAt: at(d, '11:00'),
          customer: customer(),
        }),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'SLOT_TAKEN')).toBe(
      true,
    );
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM appointments WHERE staff_id = $1 AND start_at = $2 AND status IN ('pending','confirmed')`,
      [beto, iso(d, '11:00')],
    );
    expect(rows[0].n).toBe(1);
  });

  it('6 reservas simultáneas a "cualquiera" con 2 barberos → exactamente 2 ganan, una por barbero', async () => {
    const d = limaDate(9, 3);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        pub.book({
          serviceIds: [barba],
          staffId: null,
          startAt: at(d, '16:00'),
          customer: customer(),
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((r) => r.body.staff.id))).toEqual(new Set([S.staffId, beto]));
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
  });
});

describe('gestión de la cita por enlace', () => {
  it('ver, .ics, reprogramar y cancelar; el horario se libera', async () => {
    const d = limaDate(10, 4); // jueves
    const booked = await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d, '10:00'),
        customer: { fullName: 'María López', phone: '911222333' },
      })
      .expect(201);
    const token = booked.body.manageToken as string;

    const view = await request(t.http).get(`/v1/public/appointments/${token}`).expect(200);
    expect(view.body).toMatchObject({
      customerName: 'María',
      canReschedule: true,
      services: [{ name: 'Corte', priceCents: 3000 }],
    });

    const ics = await request(t.http).get(`/v1/public/appointments/${token}/ics`).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain(
      `DTSTART:${iso(d, '10:00').replace(/[-:]/g, '').replace('.000', '')}`,
    );

    // Token alterado o inventado → 404
    await request(t.http)
      .get(`/v1/public/appointments/${token.slice(0, -2)}xx`)
      .expect(404);
    await request(t.http)
      .get(`/v1/public/appointments/${randomUUID()}.${'a'.repeat(32)}`)
      .expect(404);

    const moved = await request(t.http)
      .post(`/v1/public/appointments/${token}/reschedule`)
      .send({ startAt: at(d, '11:00') })
      .expect(200);
    expect(moved.body.startAt).toBe(iso(d, '11:00'));
    // 10:00 quedó libre
    const av = await pub
      .availability(`serviceIds=${S.serviceId}&staffId=${S.staffId}&from=${d}&to=${d}`)
      .expect(200);
    expect(slotsOf(av.body, d).map((s) => s.start)).toContain(iso(d, '10:00'));
    expect(slotsOf(av.body, d).map((s) => s.start)).not.toContain(iso(d, '11:00'));

    // Reprogramar a un horario ocupado → 409
    await pub
      .book({
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d, '12:00'),
        customer: customer(),
      })
      .expect(201);
    const clash = await request(t.http)
      .post(`/v1/public/appointments/${token}/reschedule`)
      .send({ startAt: at(d, '12:00') })
      .expect(409);
    expect(clash.body.code).toBe('SLOT_TAKEN');

    const canceled = await request(t.http)
      .post(`/v1/public/appointments/${token}/cancel`)
      .send({ reason: 'Me surgió algo' })
      .expect(200);
    expect(canceled.body).toMatchObject({ status: 'canceled', canCancel: false });
    await request(t.http).post(`/v1/public/appointments/${token}/cancel`).send({}).expect(409);
    const av2 = await pub
      .availability(`serviceIds=${S.serviceId}&staffId=${S.staffId}&from=${d}&to=${d}`)
      .expect(200);
    expect(slotsOf(av2.body, d).map((s) => s.start)).toContain(iso(d, '11:00'));
  });

  it('fuera de la ventana de cancelación → 409', async () => {
    const d = limaDate(1);
    await shopApi(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        cancellationWindowHours: 168,
      })
      .expect(200);
    const av = await pub.availability(`serviceIds=${barba}&from=${d}&to=${d}`).expect(200);
    const first = slotsOf(av.body, d)[0]!;
    const b = await pub
      .book({ serviceIds: [barba], staffId: null, startAt: first.start, customer: customer() })
      .expect(201);
    expect(b.body.canCancel).toBe(false);
    const r = await request(t.http)
      .post(`/v1/public/appointments/${b.body.manageToken}/cancel`)
      .send({})
      .expect(409);
    expect(r.body.title).toContain('168 h');
    await shopApi(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        slotIntervalMinutes: 15,
        minNoticeMinutes: 60,
        cancellationWindowHours: 2,
      })
      .expect(200);
  });
});

describe('feriados, excepciones y ausencias en la disponibilidad', () => {
  it('feriado y excepción cierran el día; una ausencia quita esas horas', async () => {
    const d1 = limaDate(11, 5); // viernes
    // El sábado siguiente a ESE viernes (con limaDate(11, 6) el rango quedaba al revés algunos días).
    const d2 = new Date(Date.parse(`${d1}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const o = shopApi(ownerToken);
    const before = await pub
      .availability(`serviceIds=${S.serviceId}&from=${d1}&to=${d2}`)
      .expect(200);
    expect(before.body.days.map((x: { date: string }) => x.date)).toEqual([d1, d2]);

    await o.post('/v1/shop/holidays', { date: d1, name: 'Feriado de prueba' }).expect(201);
    await o
      .post('/v1/shop/schedule-exceptions', {
        locationId: S.locationId,
        date: d2,
        isClosed: false,
        opensAt: '09:00',
        closesAt: '10:00',
      })
      .expect(201);
    await o
      .post(`/v1/shop/staff/${beto}/time-off`, {
        startsAt: at(d2, '09:00'),
        endsAt: at(d2, '10:00'),
      })
      .expect(201);

    const after = await pub
      .availability(`serviceIds=${S.serviceId}&from=${d1}&to=${d2}`)
      .expect(200);
    expect(after.body.days.map((x: { date: string }) => x.date)).toEqual([d2]);
    const slots = slotsOf(after.body, d2);
    expect(slots.map((s) => s.start)).toEqual([
      iso(d2, '09:00'),
      iso(d2, '09:15'),
      iso(d2, '09:30'),
    ]);
    expect(slots.every((s) => s.staffIds!.length === 1 && s.staffIds![0] === S.staffId)).toBe(true);
  });
});

describe('agenda del panel', () => {
  // Otro lunes, siempre distinto de MON() (que cae entre +7 y +13 días): desde +14.
  const d = () => limaDate(14, 1);

  it('el owner crea una cita por teléfono; el barbero solo ve y gestiona las suyas', async () => {
    const o = shopApi(ownerToken);
    const created = await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d(), '09:00'),
        customer: { fullName: 'Pedro Ruiz', phone: '944555666' },
        source: 'phone',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'confirmed',
      source: 'phone',
      customer: { fullName: 'Pedro Ruiz', phone: '+51944555666' },
    });

    const b = shopApi(barberUser.token);
    await b
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d(), '10:00'),
      })
      .expect(403);
    const mine = await b
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: beto,
        startAt: at(d(), '10:00'),
        customer: { fullName: 'Ana Díaz', phone: '933444555' },
      })
      .expect(201);

    const list = await b
      .get(`/v1/shop/appointments?from=${at(d(), '00:00')}&to=${at(d(), '23:59')}`)
      .expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([mine.body.id]);
    await b.get(`/v1/shop/appointments/${created.body.id}`).expect(403);
    await b
      .post(`/v1/shop/appointments/${created.body.id}/status`, { status: 'in_progress' })
      .expect(403);
  });

  it('teléfonos enmascarados si el rol no puede ver contactos', async () => {
    await shopApi(ownerToken)
      .put('/v1/shop/settings/permissions', { barber: { 'customers.view_contact': false } })
      .expect(200);
    const list = await shopApi(barberUser.token)
      .get(`/v1/shop/appointments?from=${at(d(), '00:00')}&to=${at(d(), '23:59')}`)
      .expect(200);
    expect(list.body[0].customer.phone).toBe('+51 ••• ••• 555');
    await shopApi(ownerToken).put('/v1/shop/settings/permissions', {}).expect(200);
  });

  it('force: fuera de horario sí, superpuesta nunca', async () => {
    const o = shopApi(ownerToken);
    await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(SUN(), '10:00'),
      })
      .expect(409);
    await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(SUN(), '10:00'),
        force: true,
      })
      .expect(201);
    const clash = await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(SUN(), '10:15'),
        force: true,
      })
      .expect(409);
    expect(clash.body.code).toBe('SLOT_TAKEN');
    await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: null,
        startAt: at(SUN(), '11:00'),
        force: true,
      })
      .expect(400);
  });

  it('walk-in sin hora empieza ahora', async () => {
    const res = await shopApi(ownerToken)
      .post('/v1/shop/appointments', {
        serviceIds: [barba],
        staffId: beto,
        source: 'walk_in',
        status: 'in_progress',
      })
      .expect(201);
    expect(Math.abs(new Date(res.body.startAt).getTime() - Date.now())).toBeLessThan(90_000);
    expect(res.body).toMatchObject({ status: 'in_progress', source: 'walk_in', customer: null });
  });

  it('ciclo de estados y efectos en el cliente', async () => {
    const o = shopApi(ownerToken);
    const a = await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d(), '15:00'),
        customer: { fullName: 'Ciclo', phone: '955666777' },
      })
      .expect(201);
    await o
      .post(`/v1/shop/appointments/${a.body.id}/status`, { status: 'in_progress' })
      .expect(200);
    const done = await o
      .post(`/v1/shop/appointments/${a.body.id}/status`, { status: 'completed' })
      .expect(200);
    expect(done.body.status).toBe('completed');
    await o.post(`/v1/shop/appointments/${a.body.id}/status`, { status: 'canceled' }).expect(409);

    const n = await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d(), '16:00'),
        customer: { id: a.body.customer.id },
      })
      .expect(201);
    const ns = await o
      .post(`/v1/shop/appointments/${n.body.id}/status`, { status: 'no_show' })
      .expect(200);
    expect(ns.body.customer.noShowCount).toBe(1);
    const { rows } = await owner.query(`SELECT last_visit_at FROM customers WHERE id = $1`, [
      a.body.customer.id,
    ]);
    expect(rows[0].last_visit_at).not.toBeNull();
  });

  it('arrastrar a otro barbero recalcula duración y precio', async () => {
    const o = shopApi(ownerToken);
    const a = await o
      .post('/v1/shop/appointments', {
        serviceIds: [S.serviceId],
        staffId: S.staffId,
        startAt: at(d(), '17:00'),
      })
      .expect(201);
    expect(a.body).toMatchObject({ totalCents: 3000 });
    const moved = await o
      .post(`/v1/shop/appointments/${a.body.id}/reschedule`, {
        startAt: at(d(), '17:30'),
        staffId: beto,
      })
      .expect(200);
    expect(moved.body).toMatchObject({
      staff: { id: beto },
      totalCents: 4000,
      startAt: iso(d(), '17:30'),
      endAt: iso(d(), '18:15'),
    });
    expect(moved.body.items[0]).toMatchObject({ priceCents: 4000, durationMin: 45 });
  });

  it('bloqueos en la agenda: lista combinada por rango; recepción puede bloquear a cualquiera', async () => {
    const day = limaDate(20, 2); // un martes
    const o = shopApi(ownerToken);
    await o
      .post(`/v1/shop/staff/${S.staffId}/time-off`, {
        startsAt: at(day, '11:00'),
        endsAt: at(day, '12:00'),
        reason: 'Almuerzo largo',
      })
      .expect(201);
    await o
      .post(`/v1/shop/staff/${beto}/time-off`, {
        startsAt: at(day, '16:00'),
        endsAt: at(day, '17:00'),
        kind: 'absence',
      })
      .expect(201);

    const range = `from=${at(day, '00:00')}&to=${at(day, '23:59')}`;
    const all = await o.get(`/v1/shop/time-off?${range}`).expect(200);
    expect(all.body).toEqual([
      expect.objectContaining({ staffId: S.staffId, kind: 'block', reason: 'Almuerzo largo' }),
      expect.objectContaining({ staffId: beto, kind: 'absence' }),
    ]);
    const filtered = await o.get(`/v1/shop/time-off?${range}&staffId=${beto}`).expect(200);
    expect(filtered.body).toHaveLength(1);
    // El barbero solo ve lo suyo.
    const own = await shopApi(barberUser.token).get(`/v1/shop/time-off?${range}`).expect(200);
    expect(own.body.map((r: { staffId: string }) => r.staffId)).toEqual([beto]);
    await o
      .get(`/v1/shop/time-off?from=${at(day, '00:00')}&to=${at(limaDate(90), '00:00')}`)
      .expect(409);

    // Recepción: bloqueos sí (de cualquiera), vacaciones no.
    const userId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Recepción', now())`,
      [userId, `recep-${userId}@test.pe`],
    );
    await owner.query(
      `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'receptionist', 'active', now())`,
      [randomUUID(), S.barbershopId, userId],
    );
    const r = shopApi(await t.tokenFor(userId));
    const block = await r
      .post(`/v1/shop/staff/${beto}/time-off`, {
        startsAt: at(day, '09:00'),
        endsAt: at(day, '09:30'),
      })
      .expect(201);
    await r
      .post(`/v1/shop/staff/${beto}/time-off`, {
        startsAt: at(day, '18:00'),
        endsAt: at(day, '19:00'),
        kind: 'vacation',
      })
      .expect(403);
    await request(t.http)
      .delete(`/v1/shop/staff/${beto}/time-off/${block.body.id}`)
      .set('Authorization', `Bearer ${await t.tokenFor(userId)}`)
      .set('X-Tenant-Slug', S.slug)
      .expect(204);
  });

  it('disponibilidad del panel ignora la anticipación mínima', async () => {
    const res = await shopApi(ownerToken)
      .get(`/v1/shop/availability?serviceIds=${barba}&from=${d()}&to=${d()}`)
      .expect(200);
    expect(res.body.staff.length).toBe(2);
  });

  it('límite de reservas mensuales del plan', async () => {
    const L = await createTenant(owner, 'blim');
    const planId = randomUUID();
    await owner.query(
      `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, updated_at) VALUES ($1, $2, 'L', 0, 0, '{"bookingsPerMonth": 1}', now())`,
      [planId, `l-${planId.slice(0, 8)}`],
    );
    await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
      planId,
      L.barbershopId,
    ]);
    const tk = await t.tokenFor(L.ownerUserId);
    const api = (u: string, b: object) =>
      request(t.http)
        .post(u)
        .set('Authorization', `Bearer ${tk}`)
        .set('X-Tenant-Slug', L.slug)
        .send(b);
    await api('/v1/shop/appointments', {
      serviceIds: [L.serviceId],
      staffId: L.staffId,
      startAt: at(SUN(), '10:00'),
      force: true,
    }).expect(201);
    const r = await api('/v1/shop/appointments', {
      serviceIds: [L.serviceId],
      staffId: L.staffId,
      startAt: at(SUN(), '11:00'),
      force: true,
    }).expect(402);
    expect(r.body.limit).toBe('bookingsPerMonth');
  });
});
