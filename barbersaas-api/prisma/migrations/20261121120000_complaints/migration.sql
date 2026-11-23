-- Libro de Reclamaciones virtual: el de Cognira (barbershop_id NULL) y uno por barbería.
CREATE TYPE "complaint_kind" AS ENUM ('reclamo', 'queja');
CREATE TYPE "complaint_status" AS ENUM ('pending', 'answered');

CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "barbershop_id" UUID,
    "seq" INTEGER NOT NULL,
    "kind" "complaint_kind" NOT NULL,
    "provider_name" TEXT NOT NULL,
    "provider_tax_id" TEXT,
    "provider_address" TEXT,
    "consumer_name" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "consumer_address" TEXT,
    "consumer_phone" TEXT,
    "consumer_email" TEXT NOT NULL,
    "guardian_name" TEXT,
    "item_type" TEXT NOT NULL,
    "item_description" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "detail" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "status" "complaint_status" NOT NULL DEFAULT 'pending',
    "response" TEXT,
    "responded_at" TIMESTAMPTZ(6),
    "responded_by" UUID,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaints_amount_chk" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0),
    CONSTRAINT "complaints_answer_chk" CHECK (("status" = 'answered') = ("response" IS NOT NULL AND "responded_at" IS NOT NULL))
);
CREATE INDEX "complaints_barbershop_id_status_idx" ON "complaints"("barbershop_id", "status");
-- Un correlativo por libro (NULL = Cognira).
CREATE UNIQUE INDEX "complaints_book_seq_uq" ON "complaints"
  (coalesce("barbershop_id", '00000000-0000-0000-0000-000000000000'::uuid), "seq");
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_barbershop_id_fkey"
  FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Registro legal: se agrega y se responde, nunca se borra.
GRANT SELECT, INSERT, UPDATE ON complaints TO barbersaas_app;
SELECT app.enable_rls('complaints');
-- Cada barbería ve su libro; la plataforma (superadmin/soporte) ve solo el de Cognira;
-- el sistema (formulario público) puede todo.
CREATE POLICY complaints_access ON complaints TO barbersaas_app
  USING (
    (barbershop_id IS NOT NULL AND barbershop_id = app.barbershop_id())
    OR (barbershop_id IS NULL AND app.is_platform())
    OR app.platform_role() = 'system'
  )
  WITH CHECK (
    (barbershop_id IS NOT NULL AND barbershop_id = app.barbershop_id())
    OR (barbershop_id IS NULL AND app.is_privileged())
    OR app.platform_role() = 'system'
  );

-- Consentimiento (Ley 29733): cuándo aceptó los Términos y la Política de privacidad al registrarse.
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(6);
