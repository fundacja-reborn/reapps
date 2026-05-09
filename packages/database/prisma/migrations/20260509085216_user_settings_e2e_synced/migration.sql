-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "settings_encrypted" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSettings_user_id_idx" ON "UserSettings"("user_id");

-- CreateIndex
CREATE INDEX "UserSettings_updated_at_idx" ON "UserSettings"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_user_id_scope_key" ON "UserSettings"("user_id", "scope");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
