-- Fase 2 · paso 19: roles personalizados por barbería.
CREATE TABLE "shop_roles" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_role" "member_role" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "shop_roles_pkey" PRIMARY KEY ("id"),
    -- Nadie más es dueño: un rol personalizado se apoya en admin, recepción o barbero.
    CONSTRAINT "shop_roles_base_role_chk" CHECK ("base_role" <> 'owner')
);
CREATE INDEX "shop_roles_barbershop_id_idx" ON "shop_roles"("barbershop_id");
CREATE UNIQUE INDEX "shop_roles_name_uq" ON "shop_roles"("barbershop_id", lower("name")) WHERE "deleted_at" IS NULL;
ALTER TABLE "shop_roles" ADD CONSTRAINT "shop_roles_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memberships" ADD COLUMN "custom_role_id" UUID;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "shop_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "memberships_custom_role_id_idx" ON "memberships"("custom_role_id");

-- Acceso de la API + aislamiento por barbería (misma política estándar que el resto).
GRANT SELECT, INSERT, UPDATE, DELETE ON "shop_roles" TO barbersaas_app;
SELECT app.enable_tenant_rls('shop_roles'::regclass);
