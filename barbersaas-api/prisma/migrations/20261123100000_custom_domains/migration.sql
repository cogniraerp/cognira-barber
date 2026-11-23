-- Dominio propio por barbería (reservas.mibarberia.pe): verificación por DNS.
ALTER TABLE "barbershops"
  ADD COLUMN "custom_domain_token" TEXT,
  ADD COLUMN "custom_domain_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "custom_domain_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "custom_domain_error" TEXT;
-- Búsqueda por hostname (resolución pública y TLS): solo los verificados.
CREATE INDEX "barbershops_custom_domain_verified_idx" ON "barbershops" (lower("custom_domain"))
  WHERE "custom_domain_verified_at" IS NOT NULL AND "deleted_at" IS NULL;
