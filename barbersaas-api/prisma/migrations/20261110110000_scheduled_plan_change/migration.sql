-- Fase 3 · paso 32: cambio de plan programado (bajar de plan o cambiar mensual/anual al fin del periodo).
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_id" UUID;
ALTER TABLE "subscriptions" ADD COLUMN "pending_interval" "billing_interval";
ALTER TABLE "subscriptions" ADD COLUMN "pending_effective_at" TIMESTAMPTZ(6);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_id_fkey" FOREIGN KEY ("pending_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "subscriptions_pending_effective_at_idx" ON "subscriptions"("pending_effective_at") WHERE "pending_effective_at" IS NOT NULL;
