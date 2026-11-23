/** Paso 8: clientes (CRM). */
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
let barber: { token: string; staffId: string; membershipId: string };

const api = (token: string) => ({
  get: (u: string) =>
    request(t.http).get(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', S.slug),
  post: (u: string, b?: object) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', S.slug)
      .send(b),
  patch: (u: string, b?: object) =>
    request(t.http)
      .patch(u)
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
    request(t.http).delete(u).set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', S.slug),
  upload: (u: string, csv: string | Buffer) =>
    request(t.http)
      .post(u)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Slug', S.slug)
      .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv), 'clientes.csv'),
});

async function appointment(
  customerId: string,
  staffId: string,
  daysFromNow: number,
  status: string,
  totalCents = 3000,
) {
  const start = new Date(Date.now() + daysFromNow * 86_400_000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  await owner.query(
    `INSERT INTO appointments (id, barbershop_id, location_id, staff_id, customer_id, start_at, end_at, block_start_at, block_end_at, status, total_cents, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7, $8, $9, now())`,
    [
      randomUUID(),
      S.barbershopId,
      S.locationId,
      staffId,
      customerId,
      start,
      end,
      status,
      totalCents,
    ],
  );
}

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  S = await createTenant(owner, 'crm');
  ownerToken = await t.tokenFor(S.ownerUserId);
  const userId = randomUUID();
  const membershipId = randomUUID();
  const staffId = randomUUID();
  await owner.query(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, 'Barbero CRM', now())`,
    [userId, `crm-${userId}@test.pe`],
  );
  await owner.query(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'barber', 'active', now())`,
    [membershipId, S.barbershopId, userId],
  );
  await owner.query(
    `INSERT INTO staff (id, barbershop_id, membership_id, display_name, updated_at) VALUES ($1, $2, $3, 'Barbero CRM', now())`,
    [staffId, S.barbershopId, membershipId],
  );
  barber = { token: await t.tokenFor(userId), staffId, membershipId };
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('alta, edición y búsqueda', () => {
  let id: string;

  it('crea con teléfono normalizado y etiquetas en minúsculas sin repetir; teléfono duplicado → 409 con el existente', async () => {
    const res = await api(ownerToken)
      .post('/v1/shop/customers', {
        fullName: 'Jorge Quispe',
        phone: '987 111 222',
        birthday: '1992-04-10',
        tags: ['VIP', 'vip', 'Fade'],
      })
      .expect(201);
    id = res.body.id;
    expect(res.body).toMatchObject({
      phone: '+51987111222',
      birthday: '1992-04-10',
      tags: ['vip', 'fade'],
      stats: { visits: 0, totalSpentCents: 0 },
    });
    const dup = await api(ownerToken)
      .post('/v1/shop/customers', { fullName: 'Otro', phone: '+51987111222' })
      .expect(409);
    expect(dup.body.existingId).toBe(id);
  });

  it('PATCH parcial; cambiar a un teléfono ajeno → 409', async () => {
    const other = await api(ownerToken)
      .post('/v1/shop/customers', { fullName: 'Rosa Mamani', phone: '987333444' })
      .expect(201);
    const upd = await api(ownerToken)
      .patch(`/v1/shop/customers/${id}`, { email: 'JORGE@MAIL.PE' })
      .expect(200);
    expect(upd.body).toMatchObject({
      email: 'jorge@mail.pe',
      phone: '+51987111222',
      tags: ['vip', 'fade'],
      birthday: '1992-04-10',
    });
    await api(ownerToken)
      .patch(`/v1/shop/customers/${other.body.id}`, { phone: '987111222' })
      .expect(409);
  });

  it('busca por nombre, teléfono (dígitos) o email; filtra por etiqueta', async () => {
    const byName = await api(ownerToken).get('/v1/shop/customers?q=quisp').expect(200);
    expect(byName.body.items.map((c: { id: string }) => c.id)).toEqual([id]);
    const byPhone = await api(ownerToken).get('/v1/shop/customers?q=111 222').expect(200);
    expect(byPhone.body.items.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(
      (await api(ownerToken).get('/v1/shop/customers?q=jorge@mail').expect(200)).body.total,
    ).toBe(1);
    expect(
      (await api(ownerToken).get('/v1/shop/customers?tag=vip').expect(200)).body.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual([id]);
    const tags = await api(ownerToken).get('/v1/shop/customers/tags').expect(200);
    expect(tags.body).toEqual(expect.arrayContaining([{ tag: 'vip', count: 1 }]));
  });

  it('estadísticas: visitas, gasto, frecuencia y próxima cita', async () => {
    await appointment(id, S.staffId, -40, 'completed', 3000);
    await appointment(id, S.staffId, -20, 'completed', 4500);
    await appointment(id, S.staffId, -10, 'no_show');
    await appointment(id, S.staffId, 5, 'confirmed');
    const res = await api(ownerToken).get(`/v1/shop/customers/${id}`).expect(200);
    expect(res.body.stats).toMatchObject({
      visits: 2,
      totalSpentCents: 7500,
      avgDaysBetweenVisits: 20,
    });
    expect(new Date(res.body.stats.nextAppointmentAt).getTime()).toBeGreaterThan(Date.now());

    const hist = await api(ownerToken)
      .get(`/v1/shop/customers/${id}/appointments?pageSize=2`)
      .expect(200);
    expect(hist.body.total).toBe(4);
    expect(hist.body.items).toHaveLength(2);
    expect(hist.body.items[0].status).toBe('confirmed'); // la más reciente primero
  });

  it('no se elimina un cliente con citas futuras; bloquear y desbloquear queda auditado', async () => {
    await api(ownerToken).delete(`/v1/shop/customers/${id}`).expect(409);
    expect(
      (
        await api(ownerToken)
          .post(`/v1/shop/customers/${id}/block`, { reason: 'No asiste' })
          .expect(200)
      ).body.isBlocked,
    ).toBe(true);
    expect(
      (await api(ownerToken).get('/v1/shop/customers?blocked=true').expect(200)).body.items.map(
        (c: { id: string }) => c.id,
      ),
    ).toContain(id);
    expect(
      (await api(ownerToken).post(`/v1/shop/customers/${id}/unblock`).expect(200)).body.isBlocked,
    ).toBe(false);
    const { rows } = await owner.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual(['shop.customer.block', 'shop.customer.unblock']);
  });
});

describe('visibilidad para barberos', () => {
  it('solo ve a sus clientes, con contacto según permisos, y su parte del historial', async () => {
    const mine = (
      await api(ownerToken)
        .post('/v1/shop/customers', {
          fullName: 'Cliente del barbero',
          phone: '911000111',
          email: 'cb@mail.pe',
        })
        .expect(201)
    ).body.id;
    const notMine = (
      await api(ownerToken)
        .post('/v1/shop/customers', { fullName: 'Cliente ajeno', phone: '911000222' })
        .expect(201)
    ).body.id;
    await appointment(mine, barber.staffId, -3, 'completed');
    await appointment(mine, S.staffId, -2, 'completed');
    await appointment(notMine, S.staffId, -1, 'completed');

    const list = await api(barber.token).get('/v1/shop/customers').expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([mine]);
    expect(list.body.items[0].phone).toBe('+51911000111'); // por defecto el barbero ve contactos
    await api(barber.token).get(`/v1/shop/customers/${notMine}`).expect(404);
    const hist = await api(barber.token).get(`/v1/shop/customers/${mine}/appointments`).expect(200);
    expect(hist.body.total).toBe(1);

    await api(ownerToken)
      .put('/v1/shop/settings/permissions', { barber: { 'customers.view_contact': false } })
      .expect(200);
    const masked = await api(barber.token).get(`/v1/shop/customers/${mine}`).expect(200);
    expect(masked.body).toMatchObject({ phone: '+51 ••• ••• 111', email: 'c***@mail.pe' });
    await api(ownerToken).put('/v1/shop/settings/permissions', {}).expect(200);

    await api(barber.token).post('/v1/shop/customers', { fullName: 'Nope' }).expect(403);
    await api(barber.token).get('/v1/shop/customers/export.csv').expect(403);
  });
});

describe('notas y fotos del corte', () => {
  it('el barbero anota y sube foto; solo el autor o un gestor borra', async () => {
    const c = (
      await api(ownerToken)
        .post('/v1/shop/customers', { fullName: 'Con notas', phone: '922000333' })
        .expect(201)
    ).body.id;
    await appointment(c, barber.staffId, -1, 'completed');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const photo = await request(t.http)
      .post('/v1/shop/uploads?kind=customer')
      .set('Authorization', `Bearer ${barber.token}`)
      .set('X-Tenant-Slug', S.slug)
      .attach('file', png, 'corte.png')
      .expect(201);
    const note = await api(barber.token)
      .post(`/v1/shop/customers/${c}/notes`, {
        body: 'Degradado bajo, máquina 1',
        imageUrl: photo.body.url,
      })
      .expect(201);
    expect(note.body).toMatchObject({
      body: 'Degradado bajo, máquina 1',
      imageUrl: photo.body.url,
      author: { fullName: 'Barbero CRM' },
    });
    await api(barber.token)
      .post(`/v1/shop/customers/${c}/notes`, { body: 'x', imageUrl: 'https://otro.sitio/foto.png' })
      .expect(400);

    const ownerNote = await api(ownerToken)
      .post(`/v1/shop/customers/${c}/notes`, { body: 'Prefiere los sábados' })
      .expect(201);
    await api(barber.token)
      .delete(`/v1/shop/customers/${c}/notes/${ownerNote.body.id}`)
      .expect(403);
    await api(barber.token).delete(`/v1/shop/customers/${c}/notes/${note.body.id}`).expect(204);
    await api(ownerToken).delete(`/v1/shop/customers/${c}/notes/${ownerNote.body.id}`).expect(204);
    expect((await api(ownerToken).get(`/v1/shop/customers/${c}/notes`).expect(200)).body).toEqual(
      [],
    );
  });
});

describe('fusionar duplicados', () => {
  it('mueve citas y notas, completa datos, une etiquetas, suma inasistencias y elimina el origen', async () => {
    const target = (
      await api(ownerToken)
        .post('/v1/shop/customers', { fullName: 'Luis Torres', phone: '933000111', tags: ['fade'] })
        .expect(201)
    ).body.id;
    const source = (
      await api(ownerToken)
        .post('/v1/shop/customers', {
          fullName: 'Lucho Torres',
          email: 'lucho@mail.pe',
          birthday: '1990-01-15',
          tags: ['barba'],
        })
        .expect(201)
    ).body.id;
    await appointment(source, S.staffId, -5, 'completed', 2500);
    await appointment(source, S.staffId, -4, 'no_show');
    await owner.query(`UPDATE customers SET no_show_count = 1 WHERE id = $1`, [source]);
    await api(ownerToken)
      .post(`/v1/shop/customers/${source}/notes`, { body: 'Nota del duplicado' })
      .expect(201);

    await api(ownerToken)
      .post(`/v1/shop/customers/${target}/merge`, { sourceId: target })
      .expect(400);
    const res = await api(ownerToken)
      .post(`/v1/shop/customers/${target}/merge`, { sourceId: source })
      .expect(200);
    expect(res.body).toMatchObject({
      fullName: 'Luis Torres',
      phone: '+51933000111',
      email: 'lucho@mail.pe',
      birthday: '1990-01-15',
      noShowCount: 1,
      stats: { visits: 1, totalSpentCents: 2500 },
    });
    expect(res.body.tags.sort()).toEqual(['barba', 'fade']);
    expect(
      (await api(ownerToken).get(`/v1/shop/customers/${target}/notes`).expect(200)).body,
    ).toHaveLength(1);
    await api(ownerToken).get(`/v1/shop/customers/${source}`).expect(404);
  });
});

describe('import / export CSV', () => {
  const csv = [
    'Nombre;Teléfono;Correo;Cumpleaños;Etiquetas;Notas',
    'Carla Ríos;987 555 001;carla@mail.pe;17/05/1990;vip|fade;Le gusta conversar',
    'Pedro Sin Datos;;;;;',
    'Teléfono Malo;12;;;;',
    'Fecha Mala;987555002;;31/02/1990;;',
    'X;987555003;;;;',
    '"Ríos, Carla (dup)";+51 987555001;;;nueva;',
    'Solo Email;;solo@mail.pe;1985-12-01;;',
  ].join('\r\n');

  it('dryRun valida y no guarda nada', async () => {
    const res = await api(ownerToken)
      .upload('/v1/shop/customers/import?dryRun=true', csv)
      .expect(200);
    expect(res.body).toMatchObject({ dryRun: true, rows: 7, created: 2, updated: 1, skipped: 4 });
    expect(res.body.columns).toEqual(['name', 'phone', 'email', 'birthday', 'tags', 'notes']);
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5, 6]);
    expect((await api(ownerToken).get('/v1/shop/customers?q=carla').expect(200)).body.total).toBe(
      0,
    );
  });

  it('import real: crea, deduplica por teléfono (sin pisar el nombre) y agrega la nota', async () => {
    const res = await api(ownerToken).upload('/v1/shop/customers/import', csv).expect(200);
    expect(res.body).toMatchObject({ dryRun: false, created: 2, updated: 1, skipped: 4 });
    const carla = (await api(ownerToken).get('/v1/shop/customers?q=987555001').expect(200)).body
      .items[0];
    expect(carla).toMatchObject({
      fullName: 'Carla Ríos',
      email: 'carla@mail.pe',
      birthday: '1990-05-17',
    });
    expect(carla.tags.sort()).toEqual(['fade', 'nueva', 'vip']);
    expect(
      (await api(ownerToken).get(`/v1/shop/customers/${carla.id}/notes`).expect(200)).body[0].body,
    ).toBe('Le gusta conversar');
    // Reimportar es idempotente: nada nuevo.
    const again = await api(ownerToken).upload('/v1/shop/customers/import', csv).expect(200);
    expect(again.body.created).toBe(0);
  });

  it('acepta CSV en Latin-1 (Excel de Windows) y rechaza archivos sin columnas clave', async () => {
    const latin1 = Buffer.from('nombre,telefono\nJosé Peña,987555010\n', 'latin1');
    expect(
      (await api(ownerToken).upload('/v1/shop/customers/import', latin1).expect(200)).body.created,
    ).toBe(1);
    expect(
      (await api(ownerToken).get('/v1/shop/customers?q=987555010').expect(200)).body.items[0]
        .fullName,
    ).toBe('José Peña');
    await api(ownerToken).upload('/v1/shop/customers/import', 'nombre,edad\nAna,30\n').expect(400);
    await api(ownerToken).upload('/v1/shop/customers/import', 'nombre,telefono\n').expect(400);
  });

  it('export: CSV con BOM, sin fórmulas ejecutables', async () => {
    await api(ownerToken)
      .post('/v1/shop/customers', { fullName: '=HYPERLINK("http://evil")', phone: '987555099' })
      .expect(201);
    const res = await api(ownerToken)
      .get('/v1/shop/customers/export.csv')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`clientes-${S.slug}-`);
    const text = res.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.split('\r\n')[0]).toBe(
      '\uFEFFnombre,telefono,email,cumpleanos,etiquetas,visitas,gasto_total,ultima_visita,no_asistio,bloqueado,cliente_desde',
    );
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain('Carla Ríos,+51987555001,carla@mail.pe,1990-05-17');
  });
});
