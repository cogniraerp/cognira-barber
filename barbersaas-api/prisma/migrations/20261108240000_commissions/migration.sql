-- Fase 2 · paso 23: comisiones.
CREATE TYPE "commission_kind" AS ENUM ('service', 'product', 'tip');

CREATE TABLE "commission_payouts" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "entries_count" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_payouts_barbershop_id_staff_id_created_at_idx" ON "commission_payouts"("barbershop_id", "staff_id", "created_at");
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "commission_entries" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "sale_item_id" UUID,
    "kind" "commission_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "base_cents" INTEGER NOT NULL,
    "rule" JSONB NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "earned_at" TIMESTAMPTZ(6) NOT NULL,
    "reversal_of_id" UUID,
    "payout_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_entries_barbershop_id_staff_id_earned_at_idx" ON "commission_entries"("barbershop_id", "staff_id", "earned_at");
CREATE INDEX "commission_entries_sale_id_idx" ON "commission_entries"("sale_id");
CREATE INDEX "commission_entries_payout_id_idx" ON "commission_entries"("payout_id");
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "commission_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT ON "commission_payouts" TO barbersaas_app;
-- Las entradas solo cambian para asignarles la liquidación (payout_id).
GRANT SELECT, INSERT, UPDATE ("payout_id") ON "commission_entries" TO barbersaas_app;
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['commission_entries', 'commission_payouts']::regclass[]) AS t;
