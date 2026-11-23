-- Fase 2 · paso 25: pasarela propia de cada barbería y cobros por link/QR.
ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'online';

CREATE TYPE "gateway_provider" AS ENUM ('simulator', 'mercadopago');
CREATE TYPE "charge_status" AS ENUM ('pending', 'paid', 'failed', 'expired', 'canceled');

CREATE TABLE "payment_gateway_accounts" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
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
    CONSTRAINT "payment_gateway_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_gateway_accounts_mode_chk" CHECK ("mode" IN ('test', 'live'))
);
CREATE UNIQUE INDEX "payment_gateway_accounts_webhook_token_hash_key" ON "payment_gateway_accounts"("webhook_token_hash");
CREATE INDEX "payment_gateway_accounts_barbershop_id_idx" ON "payment_gateway_accounts"("barbershop_id");
-- Una cuenta por proveedor y una sola activa (la que usa la caja).
CREATE UNIQUE INDEX "payment_gateway_accounts_provider_uniq" ON "payment_gateway_accounts"("barbershop_id", "provider") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "payment_gateway_accounts_active_uniq" ON "payment_gateway_accounts"("barbershop_id") WHERE "deleted_at" IS NULL AND "is_active";
ALTER TABLE "payment_gateway_accounts" ADD CONSTRAINT "payment_gateway_accounts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_charges" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PEN',
    "description" TEXT NOT NULL,
    "status" "charge_status" NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT,
    "provider_payment_id" TEXT,
    "checkout_url" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "sale_id" UUID,
    "created_by_user_id" UUID,
    "last_event" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "payment_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_charges_amount_chk" CHECK ("amount_cents" > 0)
);
CREATE UNIQUE INDEX "payment_charges_sale_id_key" ON "payment_charges"("sale_id");
CREATE INDEX "payment_charges_barbershop_id_created_at_idx" ON "payment_charges"("barbershop_id", "created_at");
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "payment_gateway_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_charges" ADD CONSTRAINT "payment_charges_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sin DELETE: las cuentas se dan de baja con deleted_at y los cobros quedan como historial.
GRANT SELECT, INSERT, UPDATE ON "payment_gateway_accounts", "payment_charges" TO barbersaas_app;
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['payment_gateway_accounts', 'payment_charges']::regclass[]) AS t;
