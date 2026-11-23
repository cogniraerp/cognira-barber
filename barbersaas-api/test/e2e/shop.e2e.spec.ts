import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, type TenantFixture } from '../support/fixtures';
import { createTestApp, type TestApp } from '../support/test-app';
import { TEST_OWNER_URL } from '../support/test-env';

/** PNG 1×1 válido. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let t: TestApp;
let owner: Client;
let A: TenantFixture;
let B: TenantFixture;
let ownerToken: string;
const sfx = Math.random().toString(36).slice(2, 7);

async function addMember(shop: TenantFixture, role: 'admin' | 'receptionist' | 'barber') {
  const userId = randomUUID();
  const email = `${role}-${userId.slice(0, 8)}@test.pe`;
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, $3, now())`,
    [userId, email, role],
  );
  const membershipId = randomUUID();
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, $4, 'active', now())`,
    [membershipId, shop.barbershopId, userId, role],
  );
  return { userId, email, membershipId, token: await t.tokenFor(userId, email) };
}

async function newUser(email = `u-${randomUUID().slice(0, 8)}@test.pe`) {
  const userId = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Nuevo', now())`,
    [userId, email],
  );
  return { userId, email, token: await t.tokenFor(userId, email) };
}

const shop = (token: string, slug = A.slug) => ({
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
  upload: (kind: string, data: Buffer, filename = 'imagen.png') =>
    request(t.http)
      .post(`/v1/shop/uploads?kind=${kind}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', slug)
      .attach('file', data, filename),
});

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  await owner.query(
    `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, trial_days, is_public, sort_order, updated_at)
     VALUES ($1, 'basico', 'Básico', 4900, 49000, 14, true, 0, now()) ON CONFLICT (code) DO NOTHING`,
    [randomUUID()],
  );
  A = await createTenant(owner, 'sh');
  B = await createTenant(owner, 'shb');
  ownerToken = await t.tokenFor(A.ownerUserId);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('alta self-service', () => {
  it('crea la barbería con slug generado del nombre, en prueba y con el usuario como owner', async () => {
    const u = await newUser();
    const res = await request(t.http)
      .post('/v1/me/barbershops')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ name: `Barbería Ñandú ${sfx}` })
      .expect(201);
    expect(res.body.slug).toBe(`barberia-nandu-${sfx}`);

    const again = await request(t.http)
      .post('/v1/me/barbershops')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ name: `Barbería Ñandú ${sfx}` })
      .expect(201);
    expect(again.body.slug).toBe(`barberia-nandu-${sfx}-2`);

    const ctx = await shop(u.token, res.body.slug).get('/v1/shop/context').expect(200);
    expect(ctx.body).toMatchObject({ role: 'owner', barbershop: { status: 'onboarding' } });
    expect(ctx.body.membershipId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('límite de 3 barberías propias', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) {
      await request(t.http)
        .post('/v1/me/barbershops')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ name: `Límite ${sfx} ${i}` })
        .expect(201);
    }
    await request(t.http)
      .post('/v1/me/barbershops')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ name: `Límite ${sfx} 4` })
      .expect(409);
  });

  it('disponibilidad de slug: libre, ocupado, reservado e inválido (con sugerencia)', async () => {
    const get = (s: string) =>
      request(t.http)
        .get(`/v1/public/slugs/${encodeURIComponent(s)}/availability`)
        .expect(200);
    expect((await get(`libre-${sfx}`)).body).toEqual({ slug: `libre-${sfx}`, available: true });
    expect((await get(A.slug)).body).toMatchObject({
      available: false,
      reason: 'taken',
      suggestion: `${A.slug}-2`,
    });
    expect((await get('admin')).body).toMatchObject({
      available: false,
      reason: 'reserved',
      suggestion: expect.any(String),
    });
    expect((await get('Mi Barbería!')).body).toMatchObject({
      available: false,
      reason: 'invalid',
      suggestion: 'mi-barberia',
    });
  });
});

describe('perfil', () => {
  it('cualquier miembro lo lee; editarlo requiere shop.manage', async () => {
    const barber = await addMember(A, 'barber');
    await shop(barber.token).get('/v1/shop/profile').expect(200);
    const denied = await shop(barber.token).patch('/v1/shop/profile', { name: 'Hack' }).expect(403);
    expect(denied.body.missing).toEqual(['shop.manage']);
  });

  it('actualiza datos y la dirección de la sede principal; valida el RUC', async () => {
    const res = await shop(ownerToken)
      .patch('/v1/shop/profile', {
        phone: '+51 999 888 777',
        taxId: '20123456789',
        address: { address: 'Av. Larco 123, Miraflores', lat: -12.12, lng: -77.03 },
      })
      .expect(200);
    expect(res.body).toMatchObject({
      phone: '+51 999 888 777',
      taxId: '20123456789',
      address: { address: 'Av. Larco 123, Miraflores', lat: -12.12 },
    });
    const bad = await shop(ownerToken).patch('/v1/shop/profile', { taxId: '123' }).expect(400);
    expect(bad.body.errors[0].path).toBe('taxId');
  });

  it('el slug solo lo cambia el owner, y no puede chocar con otro', async () => {
    const admin = await addMember(A, 'admin');
    await shop(admin.token)
      .patch('/v1/shop/profile', { slug: `nuevo-${sfx}` })
      .expect(403);
    await shop(ownerToken).patch('/v1/shop/profile', { slug: B.slug }).expect(409);
  });
});

describe('uploads y marca', () => {
  let logoUrl: string;

  it('sube un PNG, lo registra y lo sirve públicamente con cabeceras seguras', async () => {
    const res = await shop(ownerToken).upload('logo', PNG).expect(201);
    expect(res.body).toMatchObject({
      kind: 'logo',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    expect(res.body.key).toMatch(new RegExp(`^${A.barbershopId}/logo/[0-9a-f-]{36}\\.png$`));
    logoUrl = res.body.url;

    const path = new URL(logoUrl).pathname;
    const file = await request(t.http).get(path).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
  });

  it('rechaza SVG disfrazado de PNG, ICO fuera de favicon y archivos vacíos', async () => {
    expect((await shop(ownerToken).upload('logo', SVG, 'logo.png')).status).toBe(400);
    expect((await shop(ownerToken).upload('logo', ICO, 'logo.ico')).status).toBe(400);
    expect((await shop(ownerToken).upload('favicon', ICO, 'favicon.ico')).status).toBe(201);
    const none = await shop(ownerToken).post('/v1/shop/uploads?kind=logo').expect(400);
    expect(none.body.errors[0].path).toBe('file');
    await shop(ownerToken).post('/v1/shop/uploads?kind=virus').expect(400);
  });

  it('el permiso depende del tipo: un barbero no sube logos', async () => {
    const barber = await addMember(A, 'barber');
    const res = await shop(barber.token).upload('logo', PNG).expect(403);
    expect(res.body.missing).toEqual(['shop.manage']);
  });

  it('respeta la cuota de almacenamiento del plan', async () => {
    const Q = await createTenant(owner, 'quota');
    const planId = randomUUID();
    await owner.query(
      `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, updated_at) VALUES ($1, $2, 'Q', 0, 0, '{"storageMb": 0}', now())`,
      [planId, `q-${planId.slice(0, 8)}`],
    );
    await owner.query(`UPDATE subscriptions SET plan_id = $1 WHERE barbershop_id = $2`, [
      planId,
      Q.barbershopId,
    ]);
    const res = await shop(await t.tokenFor(Q.ownerUserId), Q.slug)
      .upload('logo', PNG)
      .expect(402);
    expect(res.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', limit: 'storageMb' });
  });

  it('la marca acepta solo imágenes propias y calcula el color de texto legible', async () => {
    const foreign = await shop(ownerToken)
      .patch('/v1/shop/branding', { logoUrl: 'https://evil.example/pixel.png' })
      .expect(400);
    expect(foreign.body.errors[0].path).toBe('logoUrl');

    // Una imagen subida por OTRA barbería tampoco vale.
    const other = await shop(await t.tokenFor(B.ownerUserId), B.slug)
      .upload('logo', PNG)
      .expect(201);
    await shop(ownerToken).patch('/v1/shop/branding', { logoUrl: other.body.url }).expect(400);

    const res = await shop(ownerToken)
      .patch('/v1/shop/branding', {
        logoUrl,
        primaryColor: '#FDE68A',
        font: 'poppins',
        socials: { instagram: '@barbas' },
      })
      .expect(200);
    expect(res.body).toMatchObject({
      logoUrl,
      primaryColor: '#fde68a',
      primaryForeground: '#000000',
      font: 'poppins',
      socials: { instagram: '@barbas', tiktok: null },
    });
    // PATCH parcial: lo anterior se conserva.
    const res2 = await shop(ownerToken)
      .patch('/v1/shop/branding', { socials: { tiktok: '@barbas.tk' } })
      .expect(200);
    expect(res2.body).toMatchObject({
      logoUrl,
      socials: { instagram: '@barbas', tiktok: '@barbas.tk' },
    });
    await shop(ownerToken).patch('/v1/shop/branding', { primaryColor: 'rojo' }).expect(400);
  });

  it('borrar un upload lo quita del disco', async () => {
    const up = await shop(ownerToken).upload('banner', PNG).expect(201);
    await shop(ownerToken).delete(`/v1/shop/uploads/${up.body.id}`).expect(204);
    await request(t.http).get(new URL(up.body.url).pathname).expect(404);
    await shop(ownerToken).delete(`/v1/shop/uploads/${up.body.id}`).expect(404);
  });
});

describe('galería', () => {
  it('agrega, reordena y elimina', async () => {
    const urls = await Promise.all(
      [1, 2, 3].map(async () => (await shop(ownerToken).upload('gallery', PNG)).body.url as string),
    );
    const ids: string[] = [];
    for (const url of urls)
      ids.push(
        (await shop(ownerToken).post('/v1/shop/gallery', { url, caption: 'Degradado' }).expect(201))
          .body.id,
      );

    // Hay que enviar TODAS las imágenes (la fixture ya trae una).
    const all = (
      (await shop(ownerToken).get('/v1/shop/gallery').expect(200)).body as Array<{ id: string }>
    ).map((g) => g.id);
    await shop(ownerToken)
      .put('/v1/shop/gallery/order', { ids: ids.slice(0, 2) })
      .expect(409);
    const reordered = await shop(ownerToken)
      .put('/v1/shop/gallery/order', { ids: [...all].reverse() })
      .expect(200);
    expect(reordered.body.map((g: { id: string }) => g.id)).toEqual([...all].reverse());

    // PATCH parcial: cambiar el texto no toca la visibilidad.
    await shop(ownerToken).patch(`/v1/shop/gallery/${ids[1]}`, { isVisible: false }).expect(200);
    const upd = await shop(ownerToken)
      .patch(`/v1/shop/gallery/${ids[1]}`, { caption: 'Fade' })
      .expect(200);
    expect(upd.body).toMatchObject({ caption: 'Fade', isVisible: false });

    await shop(ownerToken).delete(`/v1/shop/gallery/${ids[0]}`).expect(204);
    const list = await shop(ownerToken).get('/v1/shop/gallery').expect(200);
    expect(list.body.map((g: { id: string }) => g.id)).not.toContain(ids[0]);
  });
});

describe('configuración', () => {
  it('reglas de reserva: defaults, validación cruzada y reemplazo completo', async () => {
    const def = await shop(ownerToken).get('/v1/shop/settings/booking-rules').expect(200);
    expect(def.body).toMatchObject({
      minNoticeMinutes: 60,
      maxAdvanceDays: 30,
      slotIntervalMinutes: 15,
      approvalMode: 'auto',
    });

    const badField = await shop(ownerToken)
      .put('/v1/shop/settings/booking-rules', { slotIntervalMinutes: 7 })
      .expect(400);
    expect(badField.body.errors[0].path).toBe('slotIntervalMinutes');
    const badRule = await shop(ownerToken)
      .put('/v1/shop/settings/booking-rules', { allowStaffSelection: false, allowAnyStaff: false })
      .expect(400);
    expect(badRule.body.errors[0].path).toBe('allowAnyStaff');

    const ok = await shop(ownerToken)
      .put('/v1/shop/settings/booking-rules', {
        minNoticeMinutes: 120,
        slotIntervalMinutes: 30,
        approvalMode: 'manual',
        customFields: [
          {
            key: 'estilo',
            label: '¿Qué estilo buscas?',
            type: 'select',
            options: ['Clásico', 'Degradado'],
          },
        ],
      })
      .expect(200);
    expect(ok.body).toMatchObject({
      minNoticeMinutes: 120,
      maxAdvanceDays: 30,
      approvalMode: 'manual',
    });

    const barber = await addMember(A, 'barber');
    await shop(barber.token).get('/v1/shop/settings/booking-rules').expect(200);
    await shop(barber.token).put('/v1/shop/settings/booking-rules', {}).expect(403);
  });

  it('preferencias generales: zona horaria validada y reflejada en el contexto', async () => {
    await shop(ownerToken)
      .patch('/v1/shop/settings/general', { timezone: 'Marte/Olympus' })
      .expect(400);
    const res = await shop(ownerToken)
      .patch('/v1/shop/settings/general', { timezone: 'America/Bogota', timeFormat: '24h' })
      .expect(200);
    expect(res.body).toMatchObject({
      timezone: 'America/Bogota',
      timeFormat: '24h',
      dateFormat: 'dd/MM/yyyy',
      currency: 'PEN',
    });
    // PATCH parcial: cambiar solo la zona no resetea el formato de hora.
    const only = await shop(ownerToken)
      .patch('/v1/shop/settings/general', { dateFormat: 'yyyy-MM-dd' })
      .expect(200);
    expect(only.body).toMatchObject({ timeFormat: '24h', dateFormat: 'yyyy-MM-dd' });
    const ctx = await shop(ownerToken).get('/v1/shop/context').expect(200);
    expect(ctx.body.barbershop.timezone).toBe('America/Bogota');
    await shop(ownerToken)
      .patch('/v1/shop/settings/general', { timezone: 'America/Lima' })
      .expect(200);
  });

  it('matriz de permisos: el owner oculta teléfonos a barberos; un admin no puede escalar', async () => {
    const m = await shop(ownerToken)
      .put('/v1/shop/settings/permissions', { barber: { 'customers.view_contact': false } })
      .expect(200);
    const barberRow = m.body.roles.find((r: { role: string }) => r.role === 'barber');
    expect(barberRow.effective).not.toContain('customers.view_contact');
    expect(barberRow.defaults).toContain('customers.view_contact');

    const barber = await addMember(A, 'barber');
    expect((await shop(barber.token).get('/v1/shop/context')).body.permissions).not.toContain(
      'customers.view_contact',
    );

    const admin = await addMember(A, 'admin');
    const esc = await shop(admin.token)
      .put('/v1/shop/settings/permissions', { barber: { 'billing.view': true } })
      .expect(403);
    expect(esc.body.title).toContain('billing.view');
    await shop(admin.token)
      .put('/v1/shop/settings/permissions', { admin: { 'customers.export': false } })
      .expect(403);
    await shop(admin.token)
      .put('/v1/shop/settings/permissions', { receptionist: { 'customers.export': true } })
      .expect(200);
  });

  it('editar un rol reenviando la matriz completa no pisa el rol admin ni las concesiones del owner', async () => {
    // El owner ajusta el admin y concede al barbero algo que un admin no tiene.
    await shop(ownerToken)
      .put('/v1/shop/settings/permissions', {
        admin: { 'customers.export': false },
        barber: { 'billing.view': true },
      })
      .expect(200);
    const admin = await addMember(A, 'admin');
    // El admin edita Recepción y reenvía lo demás tal cual (como hace el formulario).
    const res = await shop(admin.token)
      .put('/v1/shop/settings/permissions', {
        admin: { 'customers.export': false },
        barber: { 'billing.view': true },
        receptionist: { 'reports.view': true },
      })
      .expect(200);
    const row = (r: string) => res.body.roles.find((x: { role: string }) => x.role === r);
    expect(row('admin').overrides).toEqual({ 'customers.export': false });
    expect(row('barber').overrides).toEqual({ 'billing.view': true });
    expect(row('receptionist').overrides).toEqual({ 'reports.view': true });
    // Omitir el admin tampoco lo borra; cambiarlo sí está prohibido.
    const kept = await shop(admin.token)
      .put('/v1/shop/settings/permissions', { barber: { 'billing.view': true } })
      .expect(200);
    expect(kept.body.roles.find((x: { role: string }) => x.role === 'admin').overrides).toEqual({
      'customers.export': false,
    });
    await shop(admin.token)
      .put('/v1/shop/settings/permissions', { admin: {} })
      .expect(403);
    await shop(ownerToken).put('/v1/shop/settings/permissions', {}).expect(200);
  });
});

describe('miembros e invitaciones', () => {
  it('invitar a un barbero con perfil de staff → invitación pendiente y staff creado', async () => {
    const email = `barbero-${sfx}@test.pe`;
    const res = await shop(ownerToken)
      .post('/v1/shop/members/invite', { email, role: 'barber', staff: { displayName: 'Carlos' } })
      .expect(201);
    expect(res.body.member).toMatchObject({
      email,
      role: 'barber',
      status: 'invited',
      staffId: expect.any(String),
    });
    expect(res.body.inviteUrl).toBe(`http://localhost:5173/invitacion/${res.body.inviteToken}`);
    await shop(ownerToken).post('/v1/shop/members/invite', { email, role: 'barber' }).expect(409);

    // Vista pública de la invitación: email enmascarado.
    const view = await request(t.http).get(`/v1/invitations/${res.body.inviteToken}`).expect(200);
    expect(view.body).toMatchObject({
      role: 'barber',
      email: 'b***@test.pe',
      expired: false,
      barbershop: { slug: A.slug },
    });

    // Otra cuenta no puede aceptarla.
    const intruder = await newUser();
    await request(t.http)
      .post(`/v1/invitations/${res.body.inviteToken}/accept`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .expect(403);

    // La cuenta correcta sí; luego el token deja de existir.
    const invited = await newUser(email);
    const acc = await request(t.http)
      .post(`/v1/invitations/${res.body.inviteToken}/accept`)
      .set('Authorization', `Bearer ${invited.token}`)
      .expect(200);
    expect(acc.body).toMatchObject({ slug: A.slug, role: 'barber' });
    const ctx = await shop(invited.token).get('/v1/shop/context').expect(200);
    expect(ctx.body).toMatchObject({ role: 'barber', staffId: res.body.member.staffId });
    await request(t.http)
      .post(`/v1/invitations/${res.body.inviteToken}/accept`)
      .set('Authorization', `Bearer ${invited.token}`)
      .expect(404);
  });

  it('invitación vencida → 410; reenviarla genera un token nuevo que funciona', async () => {
    const email = `vence-${sfx}@test.pe`;
    const inv = await shop(ownerToken)
      .post('/v1/shop/members/invite', { email, role: 'receptionist' })
      .expect(201);
    await owner.query(
      `UPDATE memberships SET invite_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [inv.body.member.id],
    );
    const u = await newUser(email);
    await request(t.http)
      .post(`/v1/invitations/${inv.body.inviteToken}/accept`)
      .set('Authorization', `Bearer ${u.token}`)
      .expect(410);

    const re = await shop(ownerToken)
      .post(`/v1/shop/members/${inv.body.member.id}/resend-invite`)
      .expect(200);
    expect(re.body.inviteToken).not.toBe(inv.body.inviteToken);
    await request(t.http).get(`/v1/invitations/${inv.body.inviteToken}`).expect(404);
    await request(t.http)
      .post(`/v1/invitations/${re.body.inviteToken}/accept`)
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
  });

  it('reglas de jerarquía: admin no invita admins ni gestiona al owner, a otros admins ni a sí mismo', async () => {
    const admin = await addMember(A, 'admin');
    const otherAdmin = await addMember(A, 'admin');
    await shop(admin.token)
      .post('/v1/shop/members/invite', { email: `a-${sfx}@test.pe`, role: 'admin' })
      .expect(403);
    await shop(admin.token)
      .post('/v1/shop/members/invite', { email: `o-${sfx}@test.pe`, role: 'owner' })
      .expect(400);
    await shop(admin.token)
      .post('/v1/shop/members/invite', {
        email: `p-${sfx}@test.pe`,
        role: 'barber',
        permissions: { 'billing.view': true },
      })
      .expect(403);

    const members = (await shop(ownerToken).get('/v1/shop/members').expect(200)).body as Array<{
      id: string;
      role: string;
    }>;
    const ownerMember = members.find((m) => m.role === 'owner')!;
    await shop(admin.token)
      .patch(`/v1/shop/members/${ownerMember.id}`, { status: 'disabled' })
      .expect(403);
    await shop(admin.token)
      .patch(`/v1/shop/members/${otherAdmin.membershipId}`, { status: 'disabled' })
      .expect(403);
    await shop(admin.token)
      .patch(`/v1/shop/members/${admin.membershipId}`, { role: 'receptionist' })
      .expect(403);

    const rec = await addMember(A, 'receptionist');
    const upd = await shop(admin.token)
      .patch(`/v1/shop/members/${rec.membershipId}`, { permissions: { 'customers.export': true } })
      .expect(200);
    expect(upd.body.permissions).toEqual({ 'customers.export': true });
  });

  it('deshabilitar y eliminar quitan el acceso; el perfil de staff se conserva sin login', async () => {
    const barber = await addMember(A, 'barber');
    const staffId = randomUUID();
    await owner.query(
      `INSERT INTO staff (id, barbershop_id, membership_id, display_name, updated_at) VALUES ($1, $2, $3, 'Temporal', now())`,
      [staffId, A.barbershopId, barber.membershipId],
    );
    await shop(ownerToken)
      .patch(`/v1/shop/members/${barber.membershipId}`, { status: 'disabled' })
      .expect(200);
    await shop(barber.token).get('/v1/shop/context').expect(403);
    await shop(ownerToken)
      .patch(`/v1/shop/members/${barber.membershipId}`, { status: 'active' })
      .expect(200);
    await shop(barber.token).get('/v1/shop/context').expect(200);

    await shop(ownerToken).delete(`/v1/shop/members/${barber.membershipId}`).expect(204);
    await shop(barber.token).get('/v1/shop/context').expect(403);
    const { rows } = await owner.query(
      `SELECT membership_id, deleted_at FROM staff WHERE id = $1`,
      [staffId],
    );
    expect(rows[0]).toEqual({ membership_id: null, deleted_at: null });
  });

  it('un recepcionista no gestiona miembros', async () => {
    const rec = await addMember(A, 'receptionist');
    await shop(rec.token).get('/v1/shop/members').expect(403);
  });
});

describe('onboarding', () => {
  it('pasos derivados de los datos, activación con validación y paso manual', async () => {
    const u = await newUser();
    const created = await request(t.http)
      .post('/v1/me/barbershops')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ name: `Onboarding ${sfx}` })
      .expect(201);
    const s = shop(u.token, created.body.slug);

    const initial = await s.get('/v1/shop/onboarding').expect(200);
    expect(initial.body).toMatchObject({
      status: 'onboarding',
      progress: 0,
      canActivate: false,
      bookingUrl: `http://localhost:5173/b/${created.body.slug}`,
    });
    expect(initial.body.steps.map((x: { key: string }) => x.key)).toEqual([
      'profile',
      'branding',
      'hours',
      'services',
      'staff',
      'whatsapp',
      'share',
    ]);

    await s.patch('/v1/shop/onboarding', { completeStep: 'hours' }).expect(400);
    const blocked = await s.post('/v1/shop/onboarding/activate').expect(409);
    expect(blocked.body.missing).toEqual(['profile', 'hours', 'services', 'staff']);

    // Se cargan los datos (los módulos de horarios/servicios/staff llegan en el paso 6).
    await s
      .patch('/v1/shop/profile', {
        phone: '+51 911 222 333',
        address: { address: 'Jr. de la Unión 100' },
      })
      .expect(200);
    const id = created.body.id as string;
    const { rows } = await owner.query(
      `SELECT id FROM locations WHERE barbershop_id = $1 AND is_primary`,
      [id],
    );
    await owner.query(
      `INSERT INTO business_hours (id, barbershop_id, location_id, day_of_week, opens_at, closes_at, updated_at) VALUES ($1, $2, $3, 1, '09:00', '18:00', now())`,
      [randomUUID(), id, rows[0].id],
    );
    await owner.query(
      `INSERT INTO services (id, barbershop_id, name, price_cents, duration_min, updated_at) VALUES ($1, $2, 'Corte', 3000, 30, now())`,
      [randomUUID(), id],
    );
    await owner.query(
      `INSERT INTO staff (id, barbershop_id, display_name, updated_at) VALUES ($1, $2, 'Barbero', now())`,
      [randomUUID(), id],
    );

    const share = await s.patch('/v1/shop/onboarding', { completeStep: 'share' }).expect(200);
    expect(share.body.canActivate).toBe(true);
    expect(share.body.progress).toBe(71); // 5 de 7

    const active = await s.post('/v1/shop/onboarding/activate').expect(200);
    expect(active.body.status).toBe('active');
    await s.post('/v1/shop/onboarding/activate').expect(409);
  });
});
