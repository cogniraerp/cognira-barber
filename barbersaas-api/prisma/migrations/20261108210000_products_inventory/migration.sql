-- Fase 2 · paso 20: productos e inventario por sede.
CREATE TYPE "inventory_movement_kind" AS ENUM ('purchase', 'sale', 'adjustment', 'return');

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "category" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "price_cents" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "stock_min" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_amounts_chk" CHECK ("price_cents" >= 0 AND "cost_cents" >= 0 AND "stock_min" >= 0)
);
CREATE INDEX "products_barbershop_id_name_idx" ON "products"("barbershop_id", "name");
CREATE UNIQUE INDEX "products_sku_uq" ON "products"("barbershop_id", lower("sku")) WHERE "deleted_at" IS NULL AND "sku" IS NOT NULL;
CREATE UNIQUE INDEX "products_barcode_uq" ON "products"("barbershop_id", "barcode") WHERE "deleted_at" IS NULL AND "barcode" IS NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_stocks" (
    "barbershop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "product_stocks_pkey" PRIMARY KEY ("product_id", "location_id")
);
CREATE INDEX "product_stocks_barbershop_id_idx" ON "product_stocks"("barbershop_id");
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_stocks" ADD CONSTRAINT "product_stocks_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kind" "inventory_movement_kind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "unit_cost_cents" INTEGER,
    "sale_id" UUID,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_movements_qty_chk" CHECK ("quantity" <> 0)
);
CREATE INDEX "inventory_movements_barbershop_id_created_at_idx" ON "inventory_movements"("barbershop_id", "created_at");
CREATE INDEX "inventory_movements_product_id_created_at_idx" ON "inventory_movements"("product_id", "created_at");
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "products", "product_stocks" TO barbersaas_app;
-- El libro de movimientos es solo de agregar (como audit_logs).
GRANT SELECT, INSERT ON "inventory_movements" TO barbersaas_app;
SELECT app.enable_tenant_rls(t) FROM unnest(ARRAY['products', 'product_stocks', 'inventory_movements']::regclass[]) AS t;
