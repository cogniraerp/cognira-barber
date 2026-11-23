-- AlterEnum
ALTER TYPE "message_event" ADD VALUE 'booking_requested';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "message_status" ADD VALUE 'sending';
ALTER TYPE "message_status" ADD VALUE 'manual';

-- AlterTable
ALTER TABLE "message_logs" ADD COLUMN     "action_url" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_at" TIMESTAMPTZ(6),
ADD COLUMN     "recipient_kind" TEXT NOT NULL DEFAULT 'customer';

-- CreateIndex
CREATE INDEX "message_logs_status_scheduled_for_idx" ON "message_logs"("status", "scheduled_for");
