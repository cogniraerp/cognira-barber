-- Fase 3 · paso 31: devoluciones por la pasarela de la barbería.
CREATE TYPE "refund_status" AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'pending',
    "provider_refund_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sale_id" UUID,
    "deposit_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_refunds_amount_chk" CHECK ("amount_cents" > 0)
);
-- Un cobro se devuelve una sola vez (las fallidas no cuentan: se puede reintentar creando otra).
CREATE UNIQUE INDEX "payment_refunds_charge_active_uniq" ON "payment_refunds"("charge_id") WHERE "status" <> 'failed';
CREATE INDEX "payment_refunds_status_next_idx" ON "payment_refunds"("status", "next_attempt_at");
CREATE INDEX "payment_refunds_barbershop_created_idx" ON "payment_refunds"("barbershop_id", "created_at");
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "payment_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "appointment_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "payment_refunds" TO barbersaas_app;
SELECT app.enable_tenant_rls('payment_refunds');
