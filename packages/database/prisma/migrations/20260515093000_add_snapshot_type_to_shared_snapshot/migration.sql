-- AlterTable
ALTER TABLE "SharedSnapshot" ADD COLUMN "snapshot_type" TEXT NOT NULL DEFAULT 'unknown';

-- CreateIndex
CREATE INDEX "SharedSnapshot_user_id_snapshot_type_idx" ON "SharedSnapshot"("user_id", "snapshot_type");
