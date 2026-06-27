-- CreateIndex
-- Composite index backing keyset pagination of the notes delta pull
-- (GET /api/notes ordered by (updated_at, id), scoped per user). See guideline 36.
CREATE INDEX "Note_user_id_updated_at_id_idx" ON "Note"("user_id", "updated_at", "id");
