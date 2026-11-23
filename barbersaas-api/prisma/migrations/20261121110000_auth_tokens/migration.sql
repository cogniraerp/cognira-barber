-- Recuperar contraseña y verificar correo: tokens de un solo uso (solo el hash) y la marca en users.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(6);
-- Las cuentas existentes ya se usan: se dan por verificadas.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;

CREATE TYPE "auth_token_kind" AS ENUM ('password_reset', 'email_verify');

CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "auth_token_kind" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");
CREATE INDEX "auth_tokens_user_id_kind_idx" ON "auth_tokens"("user_id", "kind");
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Solo el módulo de auth (contexto 'system'), igual que auth_sessions.
GRANT SELECT, INSERT, UPDATE ON auth_tokens TO barbersaas_app;
SELECT app.enable_rls('auth_tokens');
CREATE POLICY auth_tokens_system ON auth_tokens FOR ALL TO barbersaas_app
  USING (app.platform_role() = 'system') WITH CHECK (app.platform_role() = 'system');
