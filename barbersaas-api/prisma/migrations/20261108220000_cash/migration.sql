-- Fase 2 · paso 21: caja (turnos, arqueo, movimientos).
CREATE TYPE "cash_movement_kind" AS ENUM ('income', 'expense', 'withdrawal', 'sale', 'refund');
CREATE TYPE "payment_method" AS ENUM ('cash', 'yape', 'plin', 'card', 'transfer', 'other');

CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cash_registers_barbershop_id_idx" ON "cash_registers"("barbershop_id");
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cash_shifts" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "opened_by_user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_cents" INTEGER NOT NULL,
    "closed_by_user_id" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "expected" JSONB,
    "counted" JSONB,
    "difference_cents" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_shifts_opening_chk" CHECK ("opening_cents" >= 0)
);
CREATE INDEX "cash_shifts_barbershop_id_opened_at_idx" ON "cash_shifts"("barbershop_id", "opened_at");
-- Un solo turno abierto por caja (lo garantiza la base de datos, no solo la API).
CREATE UNIQUE INDEX "cash_shifts_one_open_uq" ON "cash_shifts"("register_id") WHERE "closed_at" IS NULL;
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "kind" "cash_movement_kind" NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "concept" TEXT NOT NULL,
    "sale_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_movements_amount_chk" CHECK ("amount_cents" > 0)
);
CREATE INDEX "cash_movements_shift_id_created_at_idx" ON "cash_movements"("shift_id", "created_at");
CREATE INDEX "cash_movements_barbershop_id_created_at_idx" ON "cash_movements"("barbershop_id", "created_at");
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "cash_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_registers" TO barbersaas_app;
GRANT SELECT, INSERT, UPDATE ON "cash_shifts" TO barbersaas_app;
-- Los movimientos de caja no se editan ni se borran (un error se corrige con otro movimiento).
GRANT SELECT, INSERT ON "cash_movements" TO barbersaas_app;
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['cash_registers', 'cash_shifts', 'cash_movements']::regclass[]) AS t;
