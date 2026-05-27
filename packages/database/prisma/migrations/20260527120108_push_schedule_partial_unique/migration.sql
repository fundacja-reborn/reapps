-- Replace the global UNIQUE(subscription_id, task_id) with a partial unique
-- index scoped to pending rows. The original constraint blocked any insert
-- with a (subscription_id, task_id) pair that already existed -- including
-- rows whose `sent_at` was already populated. As a result, rescheduling a
-- task whose previous notification had already fired raised P2002 and rolled
-- back the entire `/api/notifications/schedule` transaction, losing every
-- other pending row for the user.
--
-- The partial index keeps the idempotency guarantee we actually need (at most
-- one pending row per (subscription, task)) while letting historical sent
-- rows accumulate without conflict.
DROP INDEX "PushSchedule_subscription_id_task_id_key";

CREATE UNIQUE INDEX "PushSchedule_pending_subscription_task_unique"
  ON "PushSchedule"("subscription_id", "task_id")
  WHERE "sent_at" IS NULL;
