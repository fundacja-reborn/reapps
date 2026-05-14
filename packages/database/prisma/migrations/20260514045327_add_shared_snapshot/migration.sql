-- CreateTable
CREATE TABLE "SharedSnapshot" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "payload_encrypted" TEXT NOT NULL,
    "owner_key_wrapped" TEXT NOT NULL,
    "password_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_accessed_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "SharedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedSnapshot_slug_key" ON "SharedSnapshot"("slug");

-- CreateIndex
CREATE INDEX "SharedSnapshot_user_id_idx" ON "SharedSnapshot"("user_id");

-- CreateIndex
CREATE INDEX "SharedSnapshot_expires_at_idx" ON "SharedSnapshot"("expires_at");

-- CreateIndex
CREATE INDEX "SharedSnapshot_revoked_at_idx" ON "SharedSnapshot"("revoked_at");

-- AddForeignKey
ALTER TABLE "SharedSnapshot" ADD CONSTRAINT "SharedSnapshot_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
