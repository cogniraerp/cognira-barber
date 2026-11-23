/** Paso 6: sedes, horarios, feriados, excepciones, servicios y barberos. */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let ownerToken: string;
let barber: { userId: string; membershipId: string; staffId: string; token: string };

const api = (token: string, slug = A.slug) => ({
  get: (url: string) =>
    request(t.http).get(url).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug),
  post: (url: string, body?: object) =>
    request(t.http)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(body),
  patch: (url: string, body?: object) =>
    request(t.http)
      .patch(url)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(body),
  put: (url: string, body?: object) =>
    request(t.http)
      .put(url)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .send(body),
  delete: (url: string) =>
    request(t.http).delete(url).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug),
});

async function setPlan(shop: TenantFixture, limits: object, features: object = {}) {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, features, updated_at) VALUES ($1, $2, 'P', 0, 0, $3, $4, now())`,
    [id, `p-${id.slice(0, 8)}`, JSON.stringify(limits), JSON.stringify(features)],
  );
  await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
    id,
    shop.barbershopId,
  ]);
}

async function futureAppointment(
  shop: TenantFixture,
  staffId: string,
  locationId = shop.locationId,
) {
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  await owner.query(
    `INSERT INTO appointments (id, barbershop_id, location_id, staff_id, start_at, end_at, block_start_at, block_end_at, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 'confirmed', now())`,
    [randomUUID(), shop.barbershopId, locationId, staffId, start, end],
  );
  return { start, end };
}

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'cat');
  ownerToken = await t.tokenFor(A.ownerUserId);

  const userId = randomUUID();
  const membershipId = randomUUID();
  const staffId = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Barbero', now())`,
    [userId, `b-${userId}@test.pe`],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [membershipId, A.barbershopId, userId],
  );
  await owner.query(
    `INSERT INTO staff (id, barbershop_id, membership_id, display_name, updated_at) VALUES ($1, $2, $3, 'Luis', now())`,
    [staffId, A.barbershopId, membershipId],
  );
  barber = { userId, membershipId, staffId, token: await t.tokenFor(userId) };
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('horario semanal de la sede', () => {
  it('reemplaza la semana con bloques partidos; los días ausentes quedan cerrados', async () => {
    const res = await api(ownerToken)
      .put(`/v1/shop/locations/${A.locationId}/hours`, {
        days: [
          {
            dayOfWeek: 1,
            blocks: [
              { start: '15:00', end: '21:00' },
              { start: '09:00', end: '13:00' },
            ],
          },
          { dayOfWeek: 6, blocks: [{ start: '08:00', end: '14:00' }] },
        ],
      })
      .expect(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[1].blocks).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '15:00', end: '21:00' },
    ]);
    expect(res.body.days[0].blocks).toEqual([]);
    const again = await api(ownerToken).get(`/v1/shop/locations/${A.locationId}/hours`).expect(200);
    expect(again.body).toEqual(res.body);
  });

  it('rechaza solapamientos, fin ≤ inicio, días repetidos y horas mal formadas', async () => {
    const bad = await api(ownerToken)
      .put(`/v1/shop/locations/${A.locationId}/hours`, {
        days: [
          {
            dayOfWeek: 1,
            blocks: [
              { start: '09:00', end: '14:00' },
              { start: '13:00', end: '18:00' },
            ],
          },
          { dayOfWeek: 2, blocks: [{ start: '18:00', end: '09:00' }] },
          { dayOfWeek: 2, blocks: [] },
        ],
      })
      .expect(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['days.0.blocks.1', 'days.1.blocks.0', 'days.2.dayOfWeek']),
    );
    await api(ownerToken)
      .put(`/v1/shop/locations/${A.locationId}/hours`, {
        days: [{ dayOfWeek: 1, blocks: [{ start: '9:00', end: '24:00' }] }],
      })
      .expect(400);
  });

  it('un barbero puede verlo pero no cambiarlo', async () => {
    await api(barber.token).get(`/v1/shop/locations/${A.locationId}/hours`).expect(200);
    const r = await api(barber.token)
      .put(`/v1/shop/locations/${A.locationId}/hours`, { days: [] })
      .expect(403);
    expect(r.body.missing).toEqual(['schedules.manage']);
  });
});

describe('sedes', () => {
  it('una segunda sede requiere multiLocation en el plan y respeta el límite', async () => {
    const S = await createTenant(owner, 'loc');
    const tk = await t.tokenFor(S.ownerUserId);
    await setPlan(S, {}, {});
    const r = await api(tk, S.slug).post('/v1/shop/locations', { name: 'Sede Surco' }).expect(402);
    expect(r.body.feature).toBe('multiLocation');

    await setPlan(S, { locations: 2 }, { multiLocation: true });
    const created = await api(tk, S.slug)
      .post('/v1/shop/locations', { name: 'Sede Surco', timezone: 'America/Lima' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Sede Surco', isPrimary: false });
    const r2 = await api(tk, S.slug).post('/v1/shop/locations', { name: 'Sede 3' }).expect(402);
    expect(r2.body).toMatchObject({ limit: 'locations', max: 2 });
    await api(tk, S.slug)
      .post('/v1/shop/locations', { name: 'Mala', timezone: 'Lima/Peru' })
      .expect(400);
  });

  it('cambiar la principal; no se borra la principal ni una sede con citas futuras', async () => {
    const S = await createTenant(owner, 'loc2');
    const tk = await t.tokenFor(S.ownerUserId);
    await setPlan(S, { locations: 5 }, { multiLocation: true });
    const second = (
      await api(tk, S.slug).post('/v1/shop/locations', { name: 'Segunda' }).expect(201)
    ).body;

    await api(tk, S.slug).delete(`/v1/shop/locations/${S.locationId}`).expect(409);
    const prim = await api(tk, S.slug)
      .post(`/v1/shop/locations/${second.id}/make-primary`)
      .expect(200);
    expect(prim.body.isPrimary).toBe(true);
    const list = await api(tk, S.slug).get('/v1/shop/locations').expect(200);
    expect(list.body.filter((l: { isPrimary: boolean }) => l.isPrimary)).toHaveLength(1);
    expect(list.body[0].id).toBe(second.id);

    await futureAppointment(S, S.staffId, S.locationId);
    const blocked = await api(tk, S.slug).delete(`/v1/shop/locations/${S.locationId}`).expect(409);
    // 2 = la cita de la fixture (marzo 2027) + la recién creada.
    expect(blocked.body.futureAppointments).toBe(2);
  });
});

describe('feriados y excepciones', () => {
  it('importa los feriados nacionales de Perú (idempotente)', async () => {
    const first = await api(ownerToken)
      .post('/v1/shop/holidays/import-pe', { year: 2027 })
      .expect(200);
    // La fixture ya trae Fiestas Patrias 2027-07-28 → se salta.
    expect(first.body).toEqual({ created: 15, skipped: 1 });
    expect(
      (await api(ownerToken).post('/v1/shop/holidays/import-pe', { year: 2027 }).expect(200)).body,
    ).toEqual({ created: 0, skipped: 16 });

    const list = await api(ownerToken).get('/v1/shop/holidays?year=2027').expect(200);
    expect(list.body).toHaveLength(16);
    expect(list.body).toContainEqual(
      expect.objectContaining({ date: '2027-03-26', name: 'Viernes Santo', source: 'pe_national' }),
    );
  });

  it('feriado manual: duplicado → 409; se puede borrar', async () => {
    const h = await api(ownerToken)
      .post('/v1/shop/holidays', { date: '2027-10-31', name: 'Aniversario' })
      .expect(201);
    expect(h.body).toMatchObject({ date: '2027-10-31', source: 'manual', locationId: null });
    await api(ownerToken)
      .post('/v1/shop/holidays', { date: '2027-10-31', name: 'Otra vez' })
      .expect(409);
    await api(ownerToken).delete(`/v1/shop/holidays/${h.body.id}`).expect(204);
  });

  it('excepción puntual: horario especial o cerrado, una por día y sede', async () => {
    const special = await api(ownerToken)
      .post('/v1/shop/schedule-exceptions', {
        locationId: A.locationId,
        date: '2027-12-24',
        isClosed: false,
        opensAt: '09:00',
        closesAt: '15:00',
        reason: 'Nochebuena',
      })
      .expect(201);
    expect(special.body).toMatchObject({
      date: '2027-12-24',
      isClosed: false,
      opensAt: '09:00',
      closesAt: '15:00',
    });
    await api(ownerToken)
      .post('/v1/shop/schedule-exceptions', {
        locationId: A.locationId,
        date: '2027-12-24',
        isClosed: true,
      })
      .expect(409);
    await api(ownerToken)
      .post('/v1/shop/schedule-exceptions', {
        locationId: A.locationId,
        date: '2027-12-31',
        isClosed: false,
      })
      .expect(400);
    await api(ownerToken)
      .post('/v1/shop/schedule-exceptions', {
        locationId: A.locationId,
        date: '2027-12-31',
        isClosed: false,
        opensAt: '15:00',
        closesAt: '09:00',
      })
      .expect(400);

    const list = await api(ownerToken)
      .get(`/v1/shop/schedule-exceptions?from=2027-12-01&to=2027-12-31&locationId=${A.locationId}`)
      .expect(200);
    expect(list.body.map((e: { date: string }) => e.date)).toEqual(['2027-12-24']);
  });
});

describe('servicios', () => {
  let categoryId: string;
  let serviceId: string;

  it('categorías: crear, renombrar, reordenar; borrar deja los servicios sin categoría', async () => {
    categoryId = (
      await api(ownerToken).post('/v1/shop/service-categories', { name: 'Barba' }).expect(201)
    ).body.id;
    const tmp = (
      await api(ownerToken).post('/v1/shop/service-categories', { name: 'Temporal' }).expect(201)
    ).body.id;
    const renamed = await api(ownerToken)
      .patch(`/v1/shop/service-categories/${categoryId}`, { name: 'Barba y bigote' })
      .expect(200);
    expect(renamed.body.name).toBe('Barba y bigote');

    const svc = await api(ownerToken)
      .post('/v1/shop/services', {
        name: 'Perfilado',
        priceCents: 1500,
        durationMin: 15,
        categoryId: tmp,
      })
      .expect(201);
    await api(ownerToken).delete(`/v1/shop/service-categories/${tmp}`).expect(204);
    expect(
      (await api(ownerToken).get(`/v1/shop/services/${svc.body.id}`).expect(200)).body.categoryId,
    ).toBeNull();

    const cats = (await api(ownerToken).get('/v1/shop/service-categories').expect(200))
      .body as Array<{ id: string }>;
    const reordered = await api(ownerToken)
      .put('/v1/shop/service-categories/order', { ids: cats.map((c) => c.id).reverse() })
      .expect(200);
    expect(reordered.body.map((c: { id: string }) => c.id)).toEqual(
      cats.map((c) => c.id).reverse(),
    );
  });

  it('crear con buffers y asignado a barberos; validaciones', async () => {
    const res = await api(ownerToken)
      .post('/v1/shop/services', {
        name: 'Corte + barba',
        priceCents: 4500,
        durationMin: 45,
        bufferAfterMin: 10,
        categoryId,
        staffIds: [A.staffId, barber.staffId],
      })
      .expect(201);
    serviceId = res.body.id;
    expect(res.body).toMatchObject({
      bufferBeforeMin: 0,
      bufferAfterMin: 10,
      isOnlineBookable: true,
    });
    expect(res.body.staff.map((s: { staffId: string }) => s.staffId).sort()).toEqual(
      [A.staffId, barber.staffId].sort(),
    );

    await api(ownerToken)
      .post('/v1/shop/services', { name: 'X', priceCents: -1, durationMin: 2 })
      .expect(400);
    await api(ownerToken)
      .post('/v1/shop/services', {
        name: 'Raro',
        priceCents: 100,
        durationMin: 30,
        staffIds: [randomUUID()],
      })
      .expect(400);
    await api(ownerToken)
      .post('/v1/shop/services', {
        name: 'Img',
        priceCents: 100,
        durationMin: 30,
        imageUrl: 'https://x.com/a.png',
      })
      .expect(400);
  });

  it('PATCH parcial no toca lo que no se envía; los inactivos no se listan por defecto', async () => {
    const upd = await api(ownerToken)
      .patch(`/v1/shop/services/${serviceId}`, { priceCents: 5000 })
      .expect(200);
    expect(upd.body).toMatchObject({
      priceCents: 5000,
      bufferAfterMin: 10,
      isOnlineBookable: true,
      categoryId,
    });

    await api(ownerToken).patch(`/v1/shop/services/${serviceId}`, { isActive: false }).expect(200);
    const active = await api(ownerToken).get('/v1/shop/services').expect(200);
    expect(active.body.map((s: { id: string }) => s.id)).not.toContain(serviceId);
    const all = await api(ownerToken).get('/v1/shop/services?includeInactive=true').expect(200);
    expect(all.body.map((s: { id: string }) => s.id)).toContain(serviceId);
    await api(ownerToken).patch(`/v1/shop/services/${serviceId}`, { isActive: true }).expect(200);
  });

  it('límite de servicios del plan', async () => {
    const S = await createTenant(owner, 'svclim');
    await setPlan(S, { services: 1 }); // la fixture ya trae 1
    const r = await api(await t.tokenFor(S.ownerUserId), S.slug)
      .post('/v1/shop/services', { name: 'Otro', priceCents: 100, durationMin: 30 })
      .expect(402);
    expect(r.body.limit).toBe('services');
  });

  it('un barbero ve los servicios pero no los gestiona', async () => {
    await api(barber.token).get('/v1/shop/services').expect(200);
    await api(barber.token)
      .post('/v1/shop/services', { name: 'X', priceCents: 1, durationMin: 30 })
      .expect(403);
  });
});

describe('barberos', () => {
  let staffId: string;

  it('crear, editar parcialmente y listar con su acceso al sistema', async () => {
    const res = await api(ownerToken)
      .post('/v1/shop/staff', {
        displayName: 'Mateo',
        bio: 'Especialista en fades',
        specialties: ['Fade', 'Diseños'],
        socials: { instagram: '@mateo' },
      })
      .expect(201);
    staffId = res.body.id;
    expect(res.body).toMatchObject({
      displayName: 'Mateo',
      isActive: true,
      member: null,
      servicesCount: 0,
    });

    const upd = await api(ownerToken)
      .patch(`/v1/shop/staff/${staffId}`, { socials: { tiktok: '@mateo.tk' } })
      .expect(200);
    expect(upd.body.socials).toEqual({ instagram: '@mateo', tiktok: '@mateo.tk' });
    expect(upd.body.specialties).toEqual(['Fade', 'Diseños']);

    const list = await api(ownerToken).get('/v1/shop/staff').expect(200);
    const luis = list.body.find((s: { id: string }) => s.id === barber.staffId);
    expect(luis.member).toMatchObject({ role: 'barber', status: 'active' });
  });

  it('precio y duración por barbero', async () => {
    const svc = (
      await api(ownerToken)
        .post('/v1/shop/services', { name: 'Corte clásico', priceCents: 3000, durationMin: 30 })
        .expect(201)
    ).body;
    const res = await api(ownerToken)
      .put(`/v1/shop/staff/${staffId}/services`, {
        items: [{ serviceId: svc.id, priceCentsOverride: 4000, durationMinOverride: 40 }],
      })
      .expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        serviceId: svc.id,
        basePriceCents: 3000,
        priceCents: 4000,
        durationMin: 40,
      }),
    ]);
    const fromService = await api(ownerToken).get(`/v1/shop/services/${svc.id}`).expect(200);
    expect(fromService.body.staff).toEqual([
      expect.objectContaining({ staffId, priceCents: 4000, isOverridden: true }),
    ]);
    await api(ownerToken)
      .put(`/v1/shop/staff/${staffId}/services`, {
        items: [{ serviceId: svc.id }, { serviceId: svc.id }],
      })
      .expect(400);
  });

  it('límite de barberos: crear activo o reactivar cuenta; crear inactivo no', async () => {
    const S = await createTenant(owner, 'stlim');
    const tk = await t.tokenFor(S.ownerUserId);
    await setPlan(S, { staff: 1 }); // la fixture trae 1 activo
    await api(tk, S.slug).post('/v1/shop/staff', { displayName: 'Extra' }).expect(402);
    const inactive = await api(tk, S.slug)
      .post('/v1/shop/staff', { displayName: 'Suplente', isActive: false })
      .expect(201);
    await api(tk, S.slug)
      .patch(`/v1/shop/staff/${inactive.body.id}`, { isActive: true })
      .expect(402);
  });

  it('no se desactiva ni elimina un barbero con citas futuras', async () => {
    const S = await createTenant(owner, 'stfut');
    const tk = await t.tokenFor(S.ownerUserId);
    await futureAppointment(S, S.staffId);
    await api(tk, S.slug).patch(`/v1/shop/staff/${S.staffId}`, { isActive: false }).expect(409);
    await api(tk, S.slug).delete(`/v1/shop/staff/${S.staffId}`).expect(409);
  });
});

describe('horario del barbero', () => {
  it('por defecto hereda el de la sede (y lo muestra como efectivo)', async () => {
    const res = await api(ownerToken).get(`/v1/shop/staff/${barber.staffId}/hours`).expect(200);
    expect(res.body.inheritsLocationHours).toBe(true);
    expect(res.body.days[1].blocks).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '15:00', end: '21:00' },
    ]);
  });

  it('heredando: guarda solo descansos y valida que caigan dentro del horario de la sede', async () => {
    const ok = await api(ownerToken)
      .put(`/v1/shop/staff/${barber.staffId}/hours`, {
        inheritLocationHours: true,
        days: [{ dayOfWeek: 1, blocks: [], breaks: [{ start: '11:00', end: '11:30' }] }],
      })
      .expect(200);
    expect(ok.body).toMatchObject({ inheritsLocationHours: true });
    expect(ok.body.days[1].breaks).toEqual([{ start: '11:00', end: '11:30' }]);

    const bad = await api(ownerToken)
      .put(`/v1/shop/staff/${barber.staffId}/hours`, {
        inheritLocationHours: true,
        days: [{ dayOfWeek: 1, blocks: [], breaks: [{ start: '13:30', end: '14:00' }] }],
      })
      .expect(400);
    expect(bad.body.errors[0].path).toBe('days.0.breaks.0');
  });

  it('horario propio con almuerzo; el descanso debe estar dentro del turno', async () => {
    const res = await api(ownerToken)
      .put(`/v1/shop/staff/${barber.staffId}/hours`, {
        days: [
          {
            dayOfWeek: 2,
            blocks: [{ start: '10:00', end: '19:00' }],
            breaks: [{ start: '13:00', end: '14:00' }],
          },
          { dayOfWeek: 3, blocks: [{ start: '10:00', end: '19:00' }] },
        ],
      })
      .expect(200);
    expect(res.body.inheritsLocationHours).toBe(false);
    expect(res.body.days[1].blocks).toEqual([]); // ya no hereda: lunes no trabaja
    expect(res.body.days[2]).toEqual({
      dayOfWeek: 2,
      blocks: [{ start: '10:00', end: '19:00' }],
      breaks: [{ start: '13:00', end: '14:00' }],
    });

    const bad = await api(ownerToken)
      .put(`/v1/shop/staff/${barber.staffId}/hours`, {
        days: [
          {
            dayOfWeek: 2,
            blocks: [{ start: '10:00', end: '14:00' }],
            breaks: [{ start: '13:30', end: '14:30' }],
          },
        ],
      })
      .expect(400);
    expect(bad.body.errors[0].path).toBe('days.0.breaks.0');
    await api(ownerToken)
      .put(`/v1/shop/staff/${barber.staffId}/hours`, {
        inheritLocationHours: true,
        days: [{ dayOfWeek: 2, blocks: [{ start: '10:00', end: '14:00' }] }],
      })
      .expect(400);
  });
});

describe('ausencias y bloqueos', () => {
  it('el barbero bloquea su propio horario, pero no registra vacaciones ni toca el de otros', async () => {
    const block = await api(barber.token)
      .post(`/v1/shop/staff/${barber.staffId}/time-off`, {
        startsAt: '2027-05-10T13:00:00-05:00',
        endsAt: '2027-05-10T15:00:00-05:00',
        reason: 'Trámite',
      })
      .expect(201);
    expect(block.body).toMatchObject({
      kind: 'block',
      startsAt: '2027-05-10T18:00:00.000Z',
      endsAt: '2027-05-10T20:00:00.000Z',
    });

    await api(barber.token)
      .post(`/v1/shop/staff/${barber.staffId}/time-off`, {
        startsAt: '2027-06-01T00:00:00Z',
        endsAt: '2027-06-15T00:00:00Z',
        kind: 'vacation',
      })
      .expect(403);
    await api(barber.token)
      .post(`/v1/shop/staff/${A.staffId}/time-off`, {
        startsAt: '2027-06-01T10:00:00Z',
        endsAt: '2027-06-01T11:00:00Z',
      })
      .expect(403);
    await api(barber.token).get(`/v1/shop/staff/${A.staffId}/time-off`).expect(403);

    const mine = await api(barber.token)
      .get(
        `/v1/shop/staff/${barber.staffId}/time-off?from=2027-05-01T00:00:00Z&to=2027-05-31T00:00:00Z`,
      )
      .expect(200);
    expect(mine.body.map((x: { id: string }) => x.id)).toEqual([block.body.id]);
    await api(barber.token)
      .delete(`/v1/shop/staff/${barber.staffId}/time-off/${block.body.id}`)
      .expect(204);
  });

  it('vacaciones que chocan con citas → 409 con la lista; con ignoreConflicts se crean', async () => {
    const S = await createTenant(owner, 'tof');
    const tk = await t.tokenFor(S.ownerUserId);
    const appt = await futureAppointment(S, S.staffId);
    const body = {
      startsAt: new Date(appt.start.getTime() - 86_400_000).toISOString(),
      endsAt: new Date(appt.start.getTime() + 86_400_000).toISOString(),
      kind: 'vacation',
    };
    const r = await api(tk, S.slug).post(`/v1/shop/staff/${S.staffId}/time-off`, body).expect(409);
    expect(r.body.conflicts).toHaveLength(1);
    await api(tk, S.slug)
      .post(`/v1/shop/staff/${S.staffId}/time-off`, { ...body, ignoreConflicts: true })
      .expect(201);
    await api(tk, S.slug)
      .post(`/v1/shop/staff/${S.staffId}/time-off`, {
        startsAt: '2027-01-02T10:00:00Z',
        endsAt: '2027-01-01T10:00:00Z',
      })
      .expect(400);
  });
});

describe('onboarding', () => {
  it('con sede, horario, servicio y barbero creados por la API, la barbería se puede activar', async () => {
    const userId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Nuevo', now())`,
      [userId, `onb-${userId}@test.pe`],
    );
    const tk = await t.tokenFor(userId);
    const created = await request(t.http)
      .post('/v1/me/barbershops')
      .set('Authorization', `Bearer ${tk}`)
      .send({ name: `Flujo ${userId.slice(0, 6)}` })
      .expect(201);
    const s = api(tk, created.body.slug);

    await s
      .patch('/v1/shop/profile', {
        phone: '+51 900 000 000',
        address: { address: 'Av. Arequipa 1000' },
      })
      .expect(200);
    const loc = (await s.get('/v1/shop/locations').expect(200)).body[0];
    await s
      .put(`/v1/shop/locations/${loc.id}/hours`, {
        days: [1, 2, 3, 4, 5, 6].map((d) => ({
          dayOfWeek: d,
          blocks: [{ start: '09:00', end: '20:00' }],
        })),
      })
      .expect(200);
    const staff = await s.post('/v1/shop/staff', { displayName: 'Dueño' }).expect(201);
    await s
      .post('/v1/shop/services', {
        name: 'Corte',
        priceCents: 2500,
        durationMin: 30,
        staffIds: [staff.body.id],
      })
      .expect(201);

    const ob = await s.get('/v1/shop/onboarding').expect(200);
    expect(ob.body.canActivate).toBe(true);
    expect((await s.post('/v1/shop/onboarding/activate').expect(200)).body.status).toBe('active');
  });
});
