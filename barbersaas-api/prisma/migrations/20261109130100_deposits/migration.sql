-- Fase 3 · paso 28: adelantos al reservar.

-- Una cita esperando su adelanto también ocupa el horario (apartado mientras el cliente paga).
ALTER TABLE appointments DROP CONSTRAINT appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(block_start_at, block_end_at, '[)') WITH &&
  ) WHERE (status IN ('awaiting_payment', 'pending', 'confirmed', 'in_progress') AND deleted_at IS NULL);

-- Excepción del adelanto por servicio (null = usa la regla general de la barbería).
ALTER TABLE "services" ADD COLUMN "deposit_override" JSONB;

CREATE TYPE "deposit_status" AS ENUM ('pending', 'paid', 'applied', 'refund_pending', 'refunded', 'retained', 'expired');

CREATE TABLE "appointment_deposits" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "charge_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "status" "deposit_status" NOT NULL DEFAULT 'pending',
    "hold_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "applied_sale_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "appointment_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointment_deposits_amount_chk" CHECK ("amount_cents" > 0)
);
CREATE UNIQUE INDEX "appointment_deposits_appointment_id_key" ON "appointment_deposits"("appointment_id");
CREATE UNIQUE INDEX "appointment_deposits_charge_id_key" ON "appointment_deposits"("charge_id");
CREATE INDEX "appointment_deposits_status_hold_idx" ON "appointment_deposits"("status", "hold_expires_at");
ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "payment_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_applied_sale_id_fkey" FOREIGN KEY ("applied_sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "appointment_deposits" TO barbersaas_app;
SELECT app.enable_tenant_rls('appointment_deposits');
