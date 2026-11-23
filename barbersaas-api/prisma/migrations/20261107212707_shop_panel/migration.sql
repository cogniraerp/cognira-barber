-- AlterTable
ALTER TABLE "barbershop_settings" ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "invite_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "invited_by_user_id" UUID;

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");

-- CreateIndex
CREATE INDEX "stored_files_barbershop_id_created_at_idx" ON "stored_files"("barbershop_id", "created_at");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS y restricciones (a mano) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON stored_files TO barbersaas_app;
SELECT app.enable_tenant_rls('stored_files');
ALTER TABLE stored_files ADD CONSTRAINT stored_files_size_ck CHECK (size_bytes > 0);
-- La invitación pendiente debe tener token y vencimiento; una activa debe tener usuario.
ALTER TABLE memberships ADD CONSTRAINT memberships_invite_ck CHECK (
  (status <> 'invited' OR (invite_token IS NOT NULL AND invite_email IS NOT NULL))
  AND (status = 'invited' OR user_id IS NOT NULL)
);
-- Invitaciones creadas antes de esta migración: 7 días desde ahora.
UPDATE memberships SET invite_expires_at = now() + interval '7 days'
  WHERE status = 'invited' AND invite_expires_at IS NULL;
