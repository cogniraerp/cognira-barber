-- Fase 3 · paso 33: avisos de cobranza también por WhatsApp (número de la plataforma).
ALTER TABLE "billing_notices" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'email';
ALTER TABLE "billing_notices" ADD CONSTRAINT "billing_notices_channel_ck" CHECK ("channel" IN ('email', 'whatsapp'));
DROP INDEX "billing_notices_invoice_id_kind_key";
CREATE UNIQUE INDEX "billing_notices_invoice_id_kind_channel_key" ON "billing_notices"("invoice_id", "kind", "channel");
-- skipped: no aplica (sin teléfono, o WhatsApp de cobranza desactivado).
ALTER TABLE "billing_notices" DROP CONSTRAINT "billing_notices_status_ck";
ALTER TABLE "billing_notices" ADD CONSTRAINT "billing_notices_status_ck" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped'));
