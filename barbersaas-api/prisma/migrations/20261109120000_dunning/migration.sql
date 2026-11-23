-- Fase 2 · paso 26: cobranza (renovación, avisos, morosidad, suspensión y reactivación).
ALTER TABLE "barbershops" ADD COLUMN "suspended_reason" TEXT;
ALTER TABLE "barbershops" ADD CONSTRAINT "barbershops_suspended_reason_ck" CHECK ("suspended_reason" IN ('manual', 'billing'));
-- Las suspendidas hasta hoy las hizo el superadmin a mano.
UPDATE "barbershops" SET "suspended_reason" = 'manual' WHERE "status" = 'suspended';

CREATE TYPE "billing_notice_kind" AS ENUM ('invoice_issued', 'due_soon', 'overdue', 'final_warning', 'suspended', 'reactivated');

CREATE TABLE "billing_notices" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "billing_notice_kind" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "billing_notices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_notices_status_ck" CHECK ("status" IN ('pending', 'sent', 'failed'))
);
CREATE UNIQUE INDEX "billing_notices_invoice_id_kind_key" ON "billing_notices"("invoice_id", "kind");
CREATE INDEX "billing_notices_status_idx" ON "billing_notices"("status");
ALTER TABLE "billing_notices" ADD CONSTRAINT "billing_notices_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_notices" ADD CONSTRAINT "billing_notices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "billing_notices" TO barbersaas_app;
SELECT app.enable_rls('billing_notices');
CREATE POLICY billing_notices_privileged ON billing_notices FOR ALL TO barbersaas_app
  USING (app.is_privileged()) WITH CHECK (app.is_privileged());
