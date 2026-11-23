/** Fase 2 · paso 19: roles personalizados por barbería. */
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
let B: TenantFixture;
let ownerToken: string;

const api = (token: string, slug = A.slug) => {
  const h = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`).set('X-Tenant-Slug', slug);
  return {
    get: (u: string) => h(request(t.http).get(u)),
    post: (u: string, b?: object) => h(request(t.http).post(u)).send(b),
    patch: (u: string, b?: object) => h(request(t.http).patch(u)).send(b),
    delete: (u: string) => h(request(t.http).delete(u)),
  };
};

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
  return { userId, membershipId, token: await t.tokenFor(userId, email) };
}

beforeAll(async () => {
  t = await createTestApp();
  owner = new Client({ connectionString: TEST_OWNER_URL });
  await owner.connect();
  A = await createTenant(owner, 'rol');
  B = await createTenant(owner, 'rolb');
  ownerToken = await t.tokenFor(A.ownerUserId);
});

afterAll(async () => {
  await t?.close();
  await owner?.end();
});

describe('roles personalizados', () => {
  it('el owner crea "Cajero"; asignado a un miembro, define sus permisos reales', async () => {
    const o = api(ownerToken);
    const role = await o
      .post('/v1/shop/roles', {
        name: 'Cajero',
        description: 'Cobra y maneja la caja',
        baseRole: 'receptionist',
        permissions: [
          'cash.manage',
          'customers.view',
          'appointments.view_all',
          'billing.manage',
          'cash.manage',
        ],
      })
      .expect(201);
    // Sin duplicados y sin permisos exclusivos del owner.
    expect(role.body).toMatchObject({
      name: 'Cajero',
      baseRole: 'receptionist',
      permissions: ['appointments.view_all', 'cash.manage', 'customers.view'],
      members: 0,
    });
    await o.post('/v1/shop/roles', { name: 'cajero', baseRole: 'barber' }).expect(409);

    const m = await addMember(A, 'barber');
    const upd = await o
      .patch(`/v1/shop/members/${m.membershipId}`, { customRoleId: role.body.id })
      .expect(200);
    // El rol base del miembro pasa a ser el del rol personalizado.
    expect(upd.body).toMatchObject({
      role: 'receptionist',
      customRole: { id: role.body.id, name: 'Cajero' },
    });

    const ctx = await api(m.token).get('/v1/shop/context').expect(200);
    expect(ctx.body.customRole).toEqual({ id: role.body.id, name: 'Cajero' });
    expect(ctx.body.permissions).toEqual([
      'appointments.view_all',
      'cash.manage',
      'customers.view',
    ]);
    // Sin customers.manage no puede crear clientes; sí puede verlos.
    await api(m.token).get('/v1/shop/customers').expect(200);
    await api(m.token).post('/v1/shop/customers', { fullName: 'X Y' }).expect(403);

    // Editar el rol cambia los permisos del miembro al instante.
    await o
      .patch(`/v1/shop/roles/${role.body.id}`, {
        permissions: ['cash.manage', 'customers.view', 'customers.manage'],
      })
      .expect(200);
    await api(m.token).post('/v1/shop/customers', { fullName: 'Cliente Caja' }).expect(201);
    expect((await o.get('/v1/shop/roles').expect(200)).body[0].members).toBe(1);

    // Volver al rol del sistema: cambiar `role` sin customRoleId lo quita.
    const back = await o
      .patch(`/v1/shop/members/${m.membershipId}`, { role: 'barber' })
      .expect(200);
    expect(back.body).toMatchObject({ role: 'barber', customRole: null });
  });

  it('eliminar un rol deja a sus miembros con su rol base', async () => {
    const o = api(ownerToken);
    const role = await o
      .post('/v1/shop/roles', {
        name: 'Temporal',
        baseRole: 'barber',
        permissions: ['reports.view'],
      })
      .expect(201);
    const m = await addMember(A, 'barber');
    await o.patch(`/v1/shop/members/${m.membershipId}`, { customRoleId: role.body.id }).expect(200);
    expect((await api(m.token).get('/v1/shop/context')).body.permissions).toEqual(['reports.view']);

    expect((await o.delete(`/v1/shop/roles/${role.body.id}`).expect(200)).body).toEqual({
      reassigned: 1,
    });
    const ctx = await api(m.token).get('/v1/shop/context').expect(200);
    expect(ctx.body.customRole).toBeNull();
    expect(ctx.body.permissions).toContain('appointments.view_own'); // permisos de barbero por defecto
    await o.patch(`/v1/shop/roles/${role.body.id}`, { name: 'Otro nombre' }).expect(404);
    // Con el nombre libre se puede volver a crear.
    await o.post('/v1/shop/roles', { name: 'Temporal', baseRole: 'barber' }).expect(201);
  });

  it('un admin no crea roles de nivel admin ni concede lo que no tiene; tampoco ve otras barberías', async () => {
    const admin = await addMember(A, 'admin');
    const a = api(admin.token);
    await a.post('/v1/shop/roles', { name: 'Gerente', baseRole: 'admin' }).expect(403);
    const esc = await a
      .post('/v1/shop/roles', {
        name: 'Contable',
        baseRole: 'receptionist',
        permissions: ['billing.view'],
      })
      .expect(403);
    expect(esc.body.title).toContain('billing.view');
    const ok = await a
      .post('/v1/shop/roles', {
        name: 'Recepción tarde',
        baseRole: 'receptionist',
        permissions: ['appointments.view_all'],
      })
      .expect(201);

    // Un barbero (sin members.manage) no ve ni gestiona roles.
    const barber = await addMember(A, 'barber');
    await api(barber.token).get('/v1/shop/roles').expect(403);

    // Aislamiento: el owner de B no ve ni usa los roles de A.
    const bToken = await t.tokenFor(B.ownerUserId);
    expect((await api(bToken, B.slug).get('/v1/shop/roles').expect(200)).body).toEqual([]);
    await api(bToken, B.slug).patch(`/v1/shop/roles/${ok.body.id}`, { name: 'Robado' }).expect(404);
    const bMember = await addMember(B, 'barber');
    await api(bToken, B.slug)
      .patch(`/v1/shop/members/${bMember.membershipId}`, { customRoleId: ok.body.id })
      .expect(404);
  });

  it('invitar con un rol personalizado', async () => {
    const o = api(ownerToken);
    const role = await o
      .post('/v1/shop/roles', {
        name: 'Encargado',
        baseRole: 'receptionist',
        permissions: ['staff.manage'],
      })
      .expect(201);
    const inv = await o
      .post('/v1/shop/members/invite', {
        email: `enc-${randomUUID().slice(0, 6)}@test.pe`,
        role: 'barber',
        customRoleId: role.body.id,
      })
      .expect(201);
    expect(inv.body.member).toMatchObject({
      role: 'receptionist',
      customRole: { name: 'Encargado' },
    });
  });
});
