-- =====================================================================
-- BarberSaaS · RLS, roles, funciones de contexto y restricciones
-- Escrito a mano: Prisma no modela RLS, EXCLUDE ni índices parciales.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────── Rol de runtime ───────────────────────────
-- barbersaas_app es un rol de grupo SIN login y SIN bypass de RLS.
-- El usuario con el que se conecta la API (barbersaas_api en local) es miembro de este rol.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barbersaas_app') THEN
    CREATE ROLE barbersaas_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- ───────────────────── Funciones de contexto (schema app) ─────────────────────
-- Los valores se fijan por transacción con set_config(..., true) desde la API.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.barbershop_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT nullif(current_setting('app.barbershop_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- 'superadmin' | 'support' | 'system' | NULL
CREATE OR REPLACE FUNCTION app.platform_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT nullif(current_setting('app.platform_role', true), '') $$;

-- Acceso total: superadmin y procesos internos (worker, webhooks, alta self-service, auth).
CREATE OR REPLACE FUNCTION app.is_privileged() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT coalesce(app.platform_role() IN ('superadmin', 'system'), false) $$;

-- Cualquier rol de plataforma (incluye soporte, que solo tiene lectura en tablas de plataforma).
CREATE OR REPLACE FUNCTION app.is_platform() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT coalesce(app.platform_role() IN ('superadmin', 'support', 'system'), false) $$;

GRANT USAGE ON SCHEMA app TO barbersaas_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO barbersaas_app;
GRANT USAGE ON SCHEMA public TO barbersaas_app;

-- ───────────────────────────── CHECKs ─────────────────────────────
ALTER TABLE plans               ADD CONSTRAINT plans_prices_ck CHECK (price_monthly_cents >= 0 AND price_yearly_cents >= 0 AND trial_days >= 0);
ALTER TABLE subscriptions       ADD CONSTRAINT subscriptions_discount_ck CHECK (discount_percent BETWEEN 0 AND 100);
ALTER TABLE invoices            ADD CONSTRAINT invoices_amount_ck CHECK (amount_cents >= 0);
ALTER TABLE barbershops         ADD CONSTRAINT barbershops_slug_ck CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$');
ALTER TABLE business_hours      ADD CONSTRAINT business_hours_ck CHECK (day_of_week BETWEEN 0 AND 6 AND closes_at > opens_at);
ALTER TABLE staff_hours         ADD CONSTRAINT staff_hours_ck CHECK (day_of_week BETWEEN 0 AND 6 AND ends_at > starts_at);
ALTER TABLE staff_time_off      ADD CONSTRAINT staff_time_off_ck CHECK (ends_at > starts_at);
ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_ck CHECK (
  is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
);
ALTER TABLE services            ADD CONSTRAINT services_ck CHECK (
  price_cents >= 0 AND duration_min > 0 AND buffer_before_min >= 0 AND buffer_after_min >= 0
);
ALTER TABLE staff_services      ADD CONSTRAINT staff_services_ck CHECK (
  (price_cents_override IS NULL OR price_cents_override >= 0) AND
  (duration_min_override IS NULL OR duration_min_override > 0)
);
ALTER TABLE appointments        ADD CONSTRAINT appointments_times_ck CHECK (
  end_at > start_at AND block_start_at <= start_at AND block_end_at >= end_at
);
ALTER TABLE appointments        ADD CONSTRAINT appointments_total_ck CHECK (total_cents >= 0);
ALTER TABLE usage_counters      ADD CONSTRAINT usage_counters_ck CHECK (count >= 0 AND period ~ '^\d{4}-\d{2}$');

-- ─────────────────── Anti doble reserva (exclusion constraint) ───────────────────
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(block_start_at, block_end_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed', 'in_progress') AND deleted_at IS NULL);

-- ─────────────── Unicidad compatible con soft delete (índices parciales) ───────────────
CREATE UNIQUE INDEX barbershops_slug_uq          ON barbershops (lower(slug)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX barbershops_custom_domain_uq ON barbershops (lower(custom_domain)) WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX customers_phone_uq           ON customers (barbershop_id, phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX memberships_user_uq          ON memberships (barbershop_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX locations_primary_uq         ON locations (barbershop_id) WHERE is_primary AND deleted_at IS NULL;
CREATE UNIQUE INDEX holidays_date_uq             ON holidays (barbershop_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX message_templates_uq         ON message_templates (coalesce(barbershop_id, '00000000-0000-0000-0000-000000000000'::uuid), event, channel, locale) WHERE deleted_at IS NULL;

-- ───────────────────────────── GRANTs ─────────────────────────────
-- Explícitos por tabla: lo que no está aquí, la API no lo puede tocar (p. ej. _prisma_migrations).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  plans, subscriptions, invoices, platform_settings, users, auth_sessions,
  barbershops, barbershop_settings, gallery_images, locations, memberships, staff,
  business_hours, holidays, schedule_exceptions, staff_hours, staff_time_off,
  service_categories, services, staff_services, customers, customer_notes,
  appointments, appointment_services, whatsapp_configs, message_templates, message_logs,
  usage_counters
TO barbersaas_app;
-- audit_logs es append-only
GRANT SELECT, INSERT ON audit_logs TO barbersaas_app;

-- Si en el futuro se usa Supabase, sus roles de PostgREST no deben ver nada.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────── RLS ───────────────────────────────
-- Habilita + fuerza RLS y crea la política estándar de aislamiento por barbería.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS
$fn$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format($p$
    CREATE POLICY tenant_isolation ON %s TO barbersaas_app
      USING      (barbershop_id = app.barbershop_id() OR app.is_privileged())
      WITH CHECK (barbershop_id = app.barbershop_id() OR app.is_privileged())
  $p$, tbl);
END
$fn$;
REVOKE ALL ON FUNCTION app.enable_tenant_rls(regclass) FROM PUBLIC, barbersaas_app;

CREATE OR REPLACE FUNCTION app.enable_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql AS
$fn$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
END
$fn$;
REVOKE ALL ON FUNCTION app.enable_rls(regclass) FROM PUBLIC, barbersaas_app;

-- 1) Tablas del negocio con la política estándar
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY[
  'barbershop_settings', 'gallery_images', 'locations', 'memberships', 'staff',
  'business_hours', 'holidays', 'schedule_exceptions', 'staff_hours', 'staff_time_off',
  'service_categories', 'services', 'staff_services', 'customers', 'customer_notes',
  'appointments', 'appointment_services', 'whatsapp_configs', 'message_logs', 'usage_counters'
]::regclass[]) AS t;

-- 1b) Extras sobre tablas del negocio
-- El usuario puede listar SUS memberships (selector "mis barberías").
CREATE POLICY membership_own ON memberships FOR SELECT TO barbersaas_app
  USING (user_id = app.user_id());
-- El cliente final con login ve sus fichas de cliente y sus citas en cualquier barbería.
CREATE POLICY customer_own ON customers FOR SELECT TO barbersaas_app
  USING (user_id = app.user_id());
CREATE POLICY appointment_own ON appointments FOR SELECT TO barbersaas_app
  USING (customer_id IN (SELECT c.id FROM customers c WHERE c.user_id = app.user_id()));
CREATE POLICY appointment_items_own ON appointment_services FOR SELECT TO barbersaas_app
  USING (appointment_id IN (
    SELECT a.id FROM appointments a JOIN customers c ON c.id = a.customer_id
    WHERE c.user_id = app.user_id()
  ));

-- 2) barbershops: cada tenant ve/edita la suya; la plataforma lista todas; soporte solo lee.
SELECT app.enable_rls('barbershops');
CREATE POLICY barbershop_read ON barbershops FOR SELECT TO barbersaas_app
  USING (id = app.barbershop_id() OR app.is_platform());
CREATE POLICY barbershop_insert ON barbershops FOR INSERT TO barbersaas_app
  WITH CHECK (app.is_privileged());
CREATE POLICY barbershop_update ON barbershops FOR UPDATE TO barbersaas_app
  USING (id = app.barbershop_id() OR app.is_privileged())
  WITH CHECK (id = app.barbershop_id() OR app.is_privileged());
CREATE POLICY barbershop_delete ON barbershops FOR DELETE TO barbersaas_app
  USING (app.is_privileged());

-- 3) Facturación: el tenant lee la suya (salvo soporte impersonando); solo la plataforma escribe.
SELECT app.enable_rls('subscriptions');
SELECT app.enable_rls('invoices');
CREATE POLICY billing_read ON subscriptions FOR SELECT TO barbersaas_app
  USING ((barbershop_id = app.barbershop_id() AND app.platform_role() IS DISTINCT FROM 'support') OR app.is_privileged());
CREATE POLICY billing_write ON subscriptions FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());
CREATE POLICY billing_read ON invoices FOR SELECT TO barbersaas_app
  USING ((barbershop_id = app.barbershop_id() AND app.platform_role() IS DISTINCT FROM 'support') OR app.is_privileged());
CREATE POLICY billing_write ON invoices FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());

-- 4) Tablas de plataforma legibles por todos, escribibles solo por la plataforma.
SELECT app.enable_rls('plans');
SELECT app.enable_rls('platform_settings');
CREATE POLICY plans_read  ON plans FOR SELECT TO barbersaas_app USING (true);
CREATE POLICY plans_write ON plans FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());
CREATE POLICY platform_settings_read  ON platform_settings FOR SELECT TO barbersaas_app USING (true);
CREATE POLICY platform_settings_write ON platform_settings FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());

-- 5) users: uno se ve a sí mismo; también a los miembros de su barbería actual; la plataforma ve todo.
SELECT app.enable_rls('users');
CREATE POLICY users_read ON users FOR SELECT TO barbersaas_app
  USING (
    id = app.user_id()
    OR app.is_platform()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.barbershop_id = app.barbershop_id() AND m.deleted_at IS NULL
    )
  );
CREATE POLICY users_insert ON users FOR INSERT TO barbersaas_app
  WITH CHECK (app.is_privileged());
CREATE POLICY users_update ON users FOR UPDATE TO barbersaas_app
  USING (id = app.user_id() OR app.is_privileged())
  WITH CHECK (id = app.user_id() OR app.is_privileged());
CREATE POLICY users_delete ON users FOR DELETE TO barbersaas_app
  USING (app.is_privileged());

-- Un usuario no puede auto-asignarse un rol de plataforma (aunque la RLS le deje editar su fila).
CREATE OR REPLACE FUNCTION app.guard_platform_role() RETURNS trigger
  LANGUAGE plpgsql AS
$fn$
BEGIN
  IF NEW.platform_role IS DISTINCT FROM OLD.platform_role AND NOT app.is_privileged() THEN
    RAISE EXCEPTION 'platform_role can only be changed by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER users_guard_platform_role BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.guard_platform_role();

-- 6) auth_sessions: solo procesos internos (módulo de auth en contexto 'system').
SELECT app.enable_rls('auth_sessions');
CREATE POLICY auth_sessions_system ON auth_sessions FOR ALL TO barbersaas_app
  USING (app.platform_role() = 'system') WITH CHECK (app.platform_role() = 'system');

-- 7) message_templates: las globales (barbershop_id NULL) son legibles por todos los tenants.
SELECT app.enable_rls('message_templates');
CREATE POLICY templates_read ON message_templates FOR SELECT TO barbersaas_app
  USING (barbershop_id IS NULL OR barbershop_id = app.barbershop_id() OR app.is_platform());
CREATE POLICY templates_write ON message_templates FOR ALL TO barbersaas_app
  USING (barbershop_id = app.barbershop_id() OR app.is_privileged())
  WITH CHECK (barbershop_id = app.barbershop_id() OR app.is_privileged());

-- 8) audit_logs: append-only. Cada tenant escribe/lee lo suyo; la plataforma lee todo.
SELECT app.enable_rls('audit_logs');
CREATE POLICY audit_insert ON audit_logs FOR INSERT TO barbersaas_app
  WITH CHECK (barbershop_id = app.barbershop_id() OR (barbershop_id IS NULL AND app.user_id() IS NOT NULL) OR app.is_platform());
CREATE POLICY audit_read ON audit_logs FOR SELECT TO barbersaas_app
  USING (barbershop_id = app.barbershop_id() OR app.is_platform());
