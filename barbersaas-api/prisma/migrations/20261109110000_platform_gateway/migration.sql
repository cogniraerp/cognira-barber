-- Fase 2 · paso 25b: pasarela de la plataforma y pago en línea de las facturas de suscripción.
CREATE TABLE "platform_gateways" (
    "id" UUID NOT NULL,
    "provider" "gateway_provider" NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "credentials_enc" BYTEA NOT NULL,
    "key_version" SMALLINT NOT NULL DEFAULT 1,
    "public_info" JSONB NOT NULL DEFAULT '{}',
    "webhook_token_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "status" "connection_status" NOT NULL DEFAULT 'unverified',
    "last_error" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "platform_gateways_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_gateways_mode_chk" CHECK ("mode" IN ('test', 'live'))
);
CREATE UNIQUE INDEX "platform_gateways_webhook_token_hash_key" ON "platform_gateways"("webhook_token_hash");
CREATE UNIQUE INDEX "platform_gateways_provider_uniq" ON "platform_gateways"("provider") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_gateways_active_uniq" ON "platform_gateways"((true)) WHERE "deleted_at" IS NULL AND "is_active";

CREATE TABLE "invoice_charges" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "gateway_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "charge_status" NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT,
    "provider_payment_id" TEXT,
    "checkout_url" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "last_event" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "invoice_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_charges_amount_chk" CHECK ("amount_cents" > 0)
);
CREATE INDEX "invoice_charges_invoice_id_idx" ON "invoice_charges"("invoice_id");
ALTER TABLE "invoice_charges" ADD CONSTRAINT "invoice_charges_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_charges" ADD CONSTRAINT "invoice_charges_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_charges" ADD CONSTRAINT "invoice_charges_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "platform_gateways"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "platform_gateways", "invoice_charges" TO barbersaas_app;

-- La pasarela de la plataforma (y sus credenciales cifradas) solo la ven el superadmin y los procesos internos.
SELECT app.enable_rls('platform_gateways');
CREATE POLICY platform_gateways_privileged ON platform_gateways FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());

-- Intentos de pago: la barbería ve los suyos (soporte no); solo la plataforma los crea y actualiza.
SELECT app.enable_rls('invoice_charges');
CREATE POLICY invoice_charges_read ON invoice_charges FOR SELECT TO barbersaas_app
  USING ((barbershop_id = app.barbershop_id() AND app.platform_role() IS DISTINCT FROM 'support') OR app.is_privileged());
CREATE POLICY invoice_charges_write ON invoice_charges FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());
