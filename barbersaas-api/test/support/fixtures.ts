import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export interface TenantFixture {
  barbershopId: string;
  slug: string;
  ownerUserId: string;
  customerUserId: string;
  locationId: string;
  staffId: string;
  serviceId: string;
  customerId: string;
  appointmentId: string;
}

/** Tablas del negocio con barbershop_id y política estándar `tenant_isolation`. */
export const TENANT_TABLES = [
  'barbershop_settings',
  'gallery_images',
  'locations',
  'memberships',
  'staff',
  'business_hours',
  'holidays',
  'schedule_exceptions',
  'staff_hours',
  'staff_time_off',
  'service_categories',
  'services',
  'staff_services',
  'customers',
  'customer_notes',
  'appointments',
  'appointment_services',
  'whatsapp_configs',
  'message_logs',
  'usage_counters',
  'stored_files',
  'payment_gateway_accounts',
  'payment_charges',
  // Con políticas propias, pero también aisladas por barbería:
  'subscriptions',
  'invoices',
  'audit_logs',
] as const;

let planId: string | undefined;

async function ensurePlan(owner: Client): Promise<string> {
  if (planId) return planId;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, updated_at)
     VALUES ($1, 'test-basic', 'Básico', 4900, 49000, now())
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [randomUUID()],
  );
  planId = rows[0]!.id;
  return planId;
}

/**
 * Crea (como dueño de las tablas, sin RLS) una barbería con al menos una fila en CADA tabla
 * del negocio, para poder comprobar el aislamiento tabla por tabla.
 */
export async function createTenant(owner: Client, label: string): Promise<TenantFixture> {
  const id = () => randomUUID();
  const f: TenantFixture = {
    barbershopId: id(),
    slug: `shop-${label}-${Math.random().toString(36).slice(2, 8)}`,
    ownerUserId: id(),
    customerUserId: id(),
    locationId: id(),
    staffId: id(),
    serviceId: id(),
    customerId: id(),
    appointmentId: id(),
  };
  const plan = await ensurePlan(owner);
  const membershipId = id();
  const subscriptionId = id();
  const categoryId = id();

  const q = (sql: string, params: unknown[]) => owner.query(sql, params);

  await q(
    `INSERT INTO users (id, email, full_name, updated_at) VALUES ($1, $2, $3, now()), ($4, $5, $6, now())`,
    [
      f.ownerUserId,
      `owner-${f.slug}@test.pe`,
      `Owner ${label}`,
      f.customerUserId,
      `cliente-${f.slug}@test.pe`,
      `Cliente ${label}`,
    ],
  );
  await q(
    `INSERT INTO barbershops (id, slug, name, status, updated_at) VALUES ($1, $2, $3, 'active', now())`,
    [f.barbershopId, f.slug, `Barbería ${label}`],
  );
  await q(`INSERT INTO barbershop_settings (barbershop_id, updated_at) VALUES ($1, now())`, [
    f.barbershopId,
  ]);
  await q(
    `INSERT INTO gallery_images (id, barbershop_id, url, updated_at) VALUES ($1, $2, 'https://x/y.jpg', now())`,
    [id(), f.barbershopId],
  );
  await q(
    `INSERT INTO subscriptions (id, barbershop_id, plan_id, updated_at) VALUES ($1, $2, $3, now())`,
    [subscriptionId, f.barbershopId, plan],
  );
  await q(
    `INSERT INTO invoices (id, barbershop_id, subscription_id, number, amount_cents, currency, period_start, period_end, due_at, updated_at)
     VALUES ($1, $2, $3, $4, 4900, 'PEN', now(), now() + interval '1 month', now(), now())`,
    [id(), f.barbershopId, subscriptionId, `INV-${f.slug}`],
  );
  await q(
    `INSERT INTO locations (id, barbershop_id, name, is_primary, updated_at) VALUES ($1, $2, 'Principal', true, now())`,
    [f.locationId, f.barbershopId],
  );
  await q(
    `INSERT INTO memberships (id, barbershop_id, user_id, role, status, updated_at) VALUES ($1, $2, $3, 'owner', 'active', now())`,
    [membershipId, f.barbershopId, f.ownerUserId],
  );
  await q(
    `INSERT INTO staff (id, barbershop_id, membership_id, location_id, display_name, updated_at) VALUES ($1, $2, $3, $4, 'Barbero', now())`,
    [f.staffId, f.barbershopId, membershipId, f.locationId],
  );
  await q(
    `INSERT INTO business_hours (id, barbershop_id, location_id, day_of_week, opens_at, closes_at, updated_at) VALUES ($1, $2, $3, 1, '09:00', '13:00', now())`,
    [id(), f.barbershopId, f.locationId],
  );
  await q(
    `INSERT INTO holidays (id, barbershop_id, date, name, updated_at) VALUES ($1, $2, '2027-07-28', 'Fiestas Patrias', now())`,
    [id(), f.barbershopId],
  );
  await q(
    `INSERT INTO schedule_exceptions (id, barbershop_id, location_id, date, is_closed, updated_at) VALUES ($1, $2, $3, '2027-01-02', true, now())`,
    [id(), f.barbershopId, f.locationId],
  );
  await q(
    `INSERT INTO staff_hours (id, barbershop_id, staff_id, day_of_week, starts_at, ends_at, updated_at) VALUES ($1, $2, $3, 1, '09:00', '13:00', now())`,
    [id(), f.barbershopId, f.staffId],
  );
  await q(
    `INSERT INTO staff_time_off (id, barbershop_id, staff_id, starts_at, ends_at, updated_at) VALUES ($1, $2, $3, now(), now() + interval '1 day', now())`,
    [id(), f.barbershopId, f.staffId],
  );
  await q(
    `INSERT INTO service_categories (id, barbershop_id, name, updated_at) VALUES ($1, $2, 'Cortes', now())`,
    [categoryId, f.barbershopId],
  );
  await q(
    `INSERT INTO services (id, barbershop_id, category_id, name, price_cents, duration_min, updated_at) VALUES ($1, $2, $3, 'Corte', 3000, 30, now())`,
    [f.serviceId, f.barbershopId, categoryId],
  );
  await q(
    `INSERT INTO staff_services (barbershop_id, staff_id, service_id, updated_at) VALUES ($1, $2, $3, now())`,
    [f.barbershopId, f.staffId, f.serviceId],
  );
  await q(
    `INSERT INTO customers (id, barbershop_id, user_id, full_name, phone_e164, updated_at) VALUES ($1, $2, $3, 'Cliente', '+51999000111', now())`,
    [f.customerId, f.barbershopId, f.customerUserId],
  );
  await q(
    `INSERT INTO customer_notes (id, barbershop_id, customer_id, author_membership_id, body, updated_at) VALUES ($1, $2, $3, $4, 'Degradado bajo', now())`,
    [id(), f.barbershopId, f.customerId, membershipId],
  );
  await q(
    `INSERT INTO appointments (id, barbershop_id, location_id, staff_id, customer_id, start_at, end_at, block_start_at, block_end_at, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, '2027-03-01 15:00Z', '2027-03-01 15:30Z', '2027-03-01 15:00Z', '2027-03-01 15:30Z', 'confirmed', now())`,
    [f.appointmentId, f.barbershopId, f.locationId, f.staffId, f.customerId],
  );
  await q(
    `INSERT INTO appointment_services (id, barbershop_id, appointment_id, service_id, name_snapshot, price_cents, duration_min, updated_at)
     VALUES ($1, $2, $3, $4, 'Corte', 3000, 30, now())`,
    [id(), f.barbershopId, f.appointmentId, f.serviceId],
  );
  await q(`INSERT INTO whatsapp_configs (barbershop_id, updated_at) VALUES ($1, now())`, [
    f.barbershopId,
  ]);
  await q(
    `INSERT INTO message_logs (id, barbershop_id, appointment_id, event, channel, provider, "to", status, sent_at, updated_at)
     VALUES ($1, $2, $3, 'booking_confirmed', 'whatsapp', 'wa_me', '+51999000111', 'sent', now(), now())`,
    [id(), f.barbershopId, f.appointmentId],
  );
  await q(
    `INSERT INTO usage_counters (barbershop_id, period, metric, count, updated_at) VALUES ($1, '2027-03', 'whatsapp', 1, now())`,
    [f.barbershopId],
  );
  await q(
    `INSERT INTO stored_files (id, barbershop_id, key, kind, content_type, size_bytes, updated_at)
     VALUES ($1, $2, $3, 'logo', 'image/png', 10, now())`,
    [id(), f.barbershopId, `${f.barbershopId}/logo/${id()}.png`],
  );
  await q(
    `INSERT INTO message_templates (id, barbershop_id, event, channel, body, updated_at) VALUES ($1, $2, 'reminder', 'whatsapp', 'Hola {{cliente}}', now())`,
    [id(), f.barbershopId],
  );
  // Cuenta de pasarela dada de baja (no interfiere con las pruebas) y un cobro cancelado.
  const gatewayId = id();
  await q(
    `INSERT INTO payment_gateway_accounts (id, barbershop_id, provider, credentials_enc, webhook_token_hash, is_active, deleted_at, updated_at)
     VALUES ($1, $2, 'mercadopago', '\\x00', $3, false, now(), now())`,
    [gatewayId, f.barbershopId, `fixture-${id()}`],
  );
  await q(
    `INSERT INTO payment_charges (id, barbershop_id, account_id, amount_cents, description, status, expires_at, updated_at)
     VALUES ($1, $2, $3, 1000, 'Fixture', 'canceled', now(), now())`,
    [id(), f.barbershopId, gatewayId],
  );
  await q(
    `INSERT INTO audit_logs (id, barbershop_id, actor_user_id, action) VALUES ($1, $2, $3, 'test.seed')`,
    [id(), f.barbershopId, f.ownerUserId],
  );

  return f;
}
