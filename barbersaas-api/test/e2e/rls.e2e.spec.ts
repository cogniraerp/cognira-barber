/**
 * Aislamiento multi-tenant a nivel de base de datos.
 *
 * Estos tests NO pasan por la API: se conectan directamente como el usuario de runtime
 * (barbersaas_api ∈ barbersaas_app) para demostrar que, aunque un guard de la API fallara,
 * Postgres no deja ver ni tocar datos de otra barbería.
 */
import { randomUUID } from 'node:crypto';
import { Client, DatabaseError } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, TENANT_TABLES, type TenantFixture } from '../support/fixtures';
import { TEST_APP_URL, TEST_OWNER_URL } from '../support/test-env';

type Ctx = {
  barbershopId?: string;
  userId?: string;
  platformRole?: '' | 'superadmin' | 'support' | 'system';
};

let owner: Client;
let app: Client;
/** Plantilla global de prueba: se borra al final para no contaminar otros archivos. */
const globalTplId = randomUUID();
let A: TenantFixture;
let B: TenantFixture;

/** Ejecuta `fn` como barbersaas_api dentro de una transacción con el contexto dado. Siempre hace ROLLBACK. */
async function asApp<T>(ctx: Ctx, fn: (c: Client) => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query(
      `SELECT set_config('app.barbershop_id', $1, true), set_config('app.user_id', $2, true), set_config('app.platform_role', $3, true)`,
      [ctx.barbershopId ?? '', ctx.userId ?? '', ctx.platformRole ?? ''],
    );
    return await fn(app);
  } finally {
    await app.query('ROLLBACK');
  }
}

async function count(
  c: Client,
  table: string,
  where = 'true',
  params: unknown[] = [],
): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
    params,
  );
  return Number(rows[0]!.n);
}

async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (e instanceof DatabaseError) return e.code;
    throw e;
  }
}

beforeAll(async () => {
  owner = new Client({ connectionString: TEST_OWNER_URL });
  app = new Client({ connectionString: TEST_APP_URL });
  await Promise.all([owner.connect(), app.connect()]);
  A = await createTenant(owner, 'a');
  B = await createTenant(owner, 'b');
  await owner.query(
    `INSERT INTO message_templates (id, barbershop_id, event, channel, body, updated_at)
     VALUES ($1, NULL, 'booking_confirmed', 'whatsapp', 'Global', now())`,
    [globalTplId],
  );
});

afterAll(async () => {
  await owner?.query('DELETE FROM message_templates WHERE id = $1', [globalTplId]);
  await Promise.all([owner?.end(), app?.end()]);
});

describe('rol de runtime', () => {
  it('no es superusuario, no hace bypass de RLS y no es dueño de las tablas', async () => {
    const { rows } = await app.query<{ rolsuper: boolean; rolbypassrls: boolean; owns: string }>(`
      SELECT r.rolsuper, r.rolbypassrls,
             (SELECT count(*) FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user)::text AS owns
      FROM pg_roles r WHERE r.rolname = current_user`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owns: '0' });
  });

  it('todas las tablas de public tienen RLS habilitada y forzada', async () => {
    const { rows } = await owner.query<{ relname: string }>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('no tiene acceso a la tabla de migraciones', async () => {
    expect(await pgErrorCode(app.query('SELECT 1 FROM _prisma_migrations'))).toBe('42501');
  });
});

describe('sin contexto (deny by default)', () => {
  it.each(TENANT_TABLES)('%s → 0 filas', async (table) => {
    expect(await asApp({}, (c) => count(c, table))).toBe(0);
  });

  it('barbershops y users → 0 filas; plans sí es legible', async () => {
    await asApp({}, async (c) => {
      expect(await count(c, 'barbershops')).toBe(0);
      expect(await count(c, 'users')).toBe(0);
      expect(await count(c, 'plans')).toBeGreaterThan(0);
    });
  });
});

describe('contexto de la barbería A', () => {
  const ctxA = () => ({ barbershopId: A.barbershopId, userId: A.ownerUserId });

  it.each(TENANT_TABLES)('%s → solo filas de A', async (table) => {
    await asApp(ctxA(), async (c) => {
      expect(await count(c, table)).toBeGreaterThan(0);
      expect(await count(c, table, 'barbershop_id <> $1', [A.barbershopId])).toBe(0);
    });
  });

  it('barbershops → solo la propia', async () => {
    await asApp(ctxA(), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM barbershops');
      expect(rows.map((r) => r.id)).toEqual([A.barbershopId]);
    });
  });

  it('users → se ve a sí mismo y a los miembros de A, no a los de B', async () => {
    await asApp(ctxA(), async (c) => {
      expect(await count(c, 'users', 'id = $1', [A.ownerUserId])).toBe(1);
      expect(await count(c, 'users', 'id = $1', [B.ownerUserId])).toBe(0);
    });
  });

  it('message_templates → las propias y las globales, nunca las de B', async () => {
    await asApp(ctxA(), async (c) => {
      expect(await count(c, 'message_templates', 'barbershop_id = $1', [A.barbershopId])).toBe(1);
      expect(await count(c, 'message_templates', 'barbershop_id IS NULL')).toBe(1);
      expect(await count(c, 'message_templates', 'barbershop_id = $1', [B.barbershopId])).toBe(0);
    });
  });

  it('INSERT con barbershop_id de B → rechazado por RLS', async () => {
    const code = await asApp(ctxA(), (c) =>
      pgErrorCode(
        c.query(
          `INSERT INTO services (id, barbershop_id, name, price_cents, duration_min, updated_at)
           VALUES ($1, $2, 'Hack', 0, 30, now())`,
          [randomUUID(), B.barbershopId],
        ),
      ),
    );
    expect(code).toBe('42501');
  });

  it('UPDATE / DELETE de filas de B → 0 filas afectadas', async () => {
    await asApp(ctxA(), async (c) => {
      const upd = await c.query(`UPDATE services SET name = 'x' WHERE barbershop_id = $1`, [
        B.barbershopId,
      ]);
      const del = await c.query(`DELETE FROM staff_services WHERE barbershop_id = $1`, [
        B.barbershopId,
      ]);
      const shop = await c.query(`UPDATE barbershops SET name = 'x' WHERE id = $1`, [
        B.barbershopId,
      ]);
      expect([upd.rowCount, del.rowCount, shop.rowCount]).toEqual([0, 0, 0]);
    });
  });

  it('borrado lógico: la API no tiene DELETE sobre clientes, notas, facturas ni usuarios', async () => {
    // Una transacción por tabla: tras un error, Postgres aborta la transacción.
    for (const table of ['customer_notes', 'customers', 'invoices', 'users', 'barbershops'])
      await asApp(ctxA(), async (c) => {
        expect(await pgErrorCode(c.query(`DELETE FROM ${table} WHERE false`))).toBe('42501');
      });
  });

  it('mover una fila propia a B (UPDATE barbershop_id) → rechazado', async () => {
    const code = await asApp(ctxA(), (c) =>
      pgErrorCode(
        c.query(`UPDATE services SET barbershop_id = $1 WHERE id = $2`, [
          B.barbershopId,
          A.serviceId,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('un tenant no puede crear barberías ni modificar su suscripción', async () => {
    await asApp(ctxA(), async (c) => {
      expect(
        await pgErrorCode(
          c.query(
            `INSERT INTO barbershops (id, slug, name, updated_at) VALUES ($1, 'nueva-x', 'X', now())`,
            [randomUUID()],
          ),
        ),
      ).toBe('42501');
    });
    await asApp(ctxA(), async (c) => {
      const r = await c.query(
        `UPDATE subscriptions SET status = 'active' WHERE barbershop_id = $1`,
        [A.barbershopId],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('no puede leer sesiones de auth', async () => {
    expect(await asApp(ctxA(), (c) => count(c, 'auth_sessions'))).toBe(0);
  });
});

describe('usuario sin barbería (cliente final con login)', () => {
  it('ve sus fichas de cliente y sus citas en cada barbería, nada más', async () => {
    await asApp({ userId: A.customerUserId }, async (c) => {
      expect(await count(c, 'customers')).toBe(1);
      expect(await count(c, 'appointments')).toBe(1);
      expect(await count(c, 'appointment_services')).toBe(1);
      expect(await count(c, 'appointments', 'barbershop_id = $1', [B.barbershopId])).toBe(0);
      expect(await count(c, 'services')).toBe(0);
    });
  });

  it('lista sus memberships pero no las ajenas', async () => {
    await asApp({ userId: A.ownerUserId }, async (c) => {
      const { rows } = await c.query<{ barbershop_id: string }>(
        'SELECT barbershop_id FROM memberships',
      );
      expect(rows.map((r) => r.barbershop_id)).toEqual([A.barbershopId]);
    });
  });

  it('ve las barberías donde es miembro o cliente, no las demás', async () => {
    const ids = async (userId: string) =>
      asApp({ userId }, async (c) =>
        (await c.query<{ id: string }>('SELECT id FROM barbershops')).rows.map((r) => r.id),
      );
    expect(await ids(A.ownerUserId)).toEqual([A.barbershopId]);
    expect(await ids(B.customerUserId)).toEqual([B.barbershopId]);
    expect(await ids(randomUUID())).toEqual([]);
  });

  it('no puede auto-asignarse platform_role', async () => {
    const code = await asApp({ userId: A.ownerUserId }, (c) =>
      pgErrorCode(
        c.query(`UPDATE users SET platform_role = 'superadmin' WHERE id = $1`, [A.ownerUserId]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('sí puede editar su propio perfil', async () => {
    await asApp({ userId: A.ownerUserId }, async (c) => {
      const r = await c.query(`UPDATE users SET full_name = 'Nuevo' WHERE id = $1`, [
        A.ownerUserId,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe('roles de plataforma', () => {
  it('superadmin ve todas las barberías y su facturación', async () => {
    await asApp({ platformRole: 'superadmin', userId: randomUUID() }, async (c) => {
      expect(
        await count(c, 'barbershops', 'id = ANY($1)', [[A.barbershopId, B.barbershopId]]),
      ).toBe(2);
      expect(
        await count(c, 'subscriptions', 'barbershop_id = ANY($1)', [
          [A.barbershopId, B.barbershopId],
        ]),
      ).toBe(2);
    });
  });

  it('soporte lista barberías, pero no ve facturación ni puede modificarlas', async () => {
    await asApp({ platformRole: 'support', userId: randomUUID() }, async (c) => {
      expect(
        await count(c, 'barbershops', 'id = ANY($1)', [[A.barbershopId, B.barbershopId]]),
      ).toBe(2);
      expect(await count(c, 'subscriptions')).toBe(0);
      expect(await count(c, 'invoices')).toBe(0);
      const r = await c.query(`UPDATE barbershops SET name = 'x' WHERE id = $1`, [A.barbershopId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('soporte impersonando A: ve datos de A, nada de B, y sigue sin ver facturación', async () => {
    await asApp(
      { platformRole: 'support', barbershopId: A.barbershopId, userId: randomUUID() },
      async (c) => {
        expect(await count(c, 'services', 'barbershop_id = $1', [A.barbershopId])).toBe(1);
        expect(await count(c, 'services', 'barbershop_id = $1', [B.barbershopId])).toBe(0);
        expect(await count(c, 'subscriptions')).toBe(0);
      },
    );
  });
});

describe('audit_logs (append-only)', () => {
  it('UPDATE y DELETE no están permitidos ni siquiera al superadmin', async () => {
    await asApp({ platformRole: 'superadmin' }, async (c) => {
      expect(await pgErrorCode(c.query(`UPDATE audit_logs SET action = 'x'`))).toBe('42501');
    });
    await asApp({ platformRole: 'superadmin' }, async (c) => {
      expect(await pgErrorCode(c.query(`DELETE FROM audit_logs`))).toBe('42501');
    });
  });
});

describe('anti doble reserva (exclusion constraint)', () => {
  const insertAppt = (c: Client, start: string, end: string, status = 'confirmed') =>
    c.query(
      `INSERT INTO appointments (id, barbershop_id, location_id, staff_id, start_at, end_at, block_start_at, block_end_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, now())`,
      [randomUUID(), A.barbershopId, A.locationId, A.staffId, start, end, status],
    );
  const ctxA = () => ({ barbershopId: A.barbershopId, userId: A.ownerUserId });

  // La fixture ya tiene una cita confirmada 15:00–15:30Z del 2027-03-01.
  it('rechaza una cita que se superpone con otra activa del mismo barbero', async () => {
    const code = await asApp(ctxA(), (c) =>
      pgErrorCode(insertAppt(c, '2027-03-01 15:15Z', '2027-03-01 15:45Z')),
    );
    expect(code).toBe('23P01');
  });

  it('acepta una cita contigua (rango semiabierto [inicio, fin))', async () => {
    const code = await asApp(ctxA(), (c) =>
      pgErrorCode(insertAppt(c, '2027-03-01 15:30Z', '2027-03-01 16:00Z')),
    );
    expect(code).toBeUndefined();
  });

  it('acepta superposición con una cita cancelada', async () => {
    const code = await asApp(ctxA(), (c) =>
      pgErrorCode(insertAppt(c, '2027-03-01 15:00Z', '2027-03-01 15:30Z', 'canceled')),
    );
    expect(code).toBeUndefined();
  });
});
