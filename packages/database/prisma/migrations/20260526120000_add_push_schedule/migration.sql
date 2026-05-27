-- CreateTable
CREATE TABLE "PushSchedule" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "fire_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSchedule_subscription_id_task_id_key" ON "PushSchedule"("subscription_id", "task_id");

-- CreateIndex
CREATE INDEX "PushSchedule_fire_at_sent_at_idx" ON "PushSchedule"("fire_at", "sent_at");

-- CreateIndex
CREATE INDEX "PushSchedule_user_id_idx" ON "PushSchedule"("user_id");

-- CreateIndex
CREATE INDEX "PushSchedule_subscription_id_idx" ON "PushSchedule"("subscription_id");

-- AddForeignKey
ALTER TABLE "PushSchedule" ADD CONSTRAINT "PushSchedule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSchedule" ADD CONSTRAINT "PushSchedule_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "UserWebPushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
