-- Fase 2 · paso 22: ventas (POS).
CREATE TYPE "sale_status" AS ENUM ('completed', 'voided');
CREATE TYPE "sale_item_kind" AS ENUM ('service', 'product');

ALTER TABLE "barbershop_settings" ADD COLUMN "last_sale_number" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "shift_id" UUID,
    "number" INTEGER NOT NULL,
    "customer_id" UUID,
    "appointment_id" UUID,
    "status" "sale_status" NOT NULL DEFAULT 'completed',
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tip_cents" INTEGER NOT NULL DEFAULT 0,
    "tip_staff_id" UUID,
    "total_cents" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    CONSTRAINT "sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_amounts_chk" CHECK ("subtotal_cents" >= 0 AND "discount_cents" >= 0 AND "tip_cents" >= 0 AND "total_cents" >= 0)
);
CREATE UNIQUE INDEX "sales_barbershop_id_number_key" ON "sales"("barbershop_id", "number");
CREATE INDEX "sales_barbershop_id_created_at_idx" ON "sales"("barbershop_id", "created_at");
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");
-- Una cita se cobra una sola vez (salvo que la venta se anule).
CREATE UNIQUE INDEX "sales_appointment_uq" ON "sales"("appointment_id") WHERE "status" = 'completed' AND "appointment_id" IS NOT NULL;
ALTER TABLE "sales" ADD CONSTRAINT "sales_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "kind" "sale_item_kind" NOT NULL,
    "service_id" UUID,
    "product_id" UUID,
    "staff_id" UUID,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_items_chk" CHECK ("quantity" > 0 AND "unit_price_cents" >= 0 AND "discount_cents" >= 0 AND "total_cents" >= 0)
);
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");
CREATE INDEX "sale_items_barbershop_id_staff_id_idx" ON "sale_items"("barbershop_id", "staff_id");
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reference" TEXT,
    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_payments_amount_chk" CHECK ("amount_cents" > 0)
);
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La venta solo se actualiza para anularla; ítems y pagos no se tocan.
GRANT SELECT, INSERT, UPDATE ON "sales" TO barbersaas_app;
GRANT SELECT, INSERT ON "sale_items", "sale_payments" TO barbersaas_app;
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['sales', 'sale_items', 'sale_payments']::regclass[]) AS t;
