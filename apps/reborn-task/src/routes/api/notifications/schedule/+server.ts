/**
 * POST /api/notifications/schedule
 *   Replace-all upsert of pending push schedules for the caller, fanned out
 *   across ALL of their active subscriptions.
 *   Body: { endpoint, items: [{ task_id, fire_at }] }
 *   Behavior: in one transaction, delete every unsent schedule belonging to
 *   the user (across devices), then insert `items × subscriptions`. The
 *   `endpoint` is kept in the contract for authenticity/diagnostics but the
 *   write is intentionally cross-device: each item is materialized for every
 *   active subscription so the cron wakes every signed-in device, not only
 *   the one that authored the task change. Idempotent - whichever device
 *   syncs last wins, but all devices compute the same `(task_id, fire_at)`
 *   from their identical synced task store, so the result converges.
 *
 * DELETE /api/notifications/schedule
 *   Cancel a single task's pending schedules across all of the user's
 *   subscriptions. Used when a task is completed / deleted / its due date is
 *   removed so the SW does not fire a stale reminder before the next full re-sync.
 *   Body: { task_id }
 *
 * The server only sees `(task_id, fire_at)` - the task title/body remain
 * encrypted in IndexedDB on the client. Push payloads sent by the cron
 * (hooks.server.ts) are generic wake-ups; the SW reads the task locally and
 * builds the real notification text. See planning doc:
 *   docs/development/planning/task-push-notifications-server-side.md
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { validateBody, schemas } from '@reborn/types';
import { notificationLimiter } from '$lib/server/rate-limit';

const logger = createLogger('NotificationsSchedule');

async function getUserId(authHeader: string | null): Promise<string | null> {
	const token = authHeader?.replace('Bearer ', '');
	if (!token) return null;
	try {
		const data = await verifyToken(token, 'access');
		return data?.userId ?? null;
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		if (!notificationLimiter.check(userId)) {
			const retryAfter = notificationLimiter.retryAfter(userId);
			return json(
				{ success: false, error: 'Too many requests. Please try again later.' },
				{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
			);
		}

		const body = await request.json();
		const validation = validateBody(schemas.PushScheduleBodySchema, body);
		if (!validation.success) {
			return json({ success: false, error: validation.error }, { status: 400 });
		}

		const { endpoint, items } = validation.data;

		// Verify the caller's own subscription exists - this both proves the
		// device is registered and guards against schedules from a logged-out
		// or stale browser. The actual write below fans out to every active
		// subscription of the user (multi-device delivery).
		const callerSubscription = await prisma.userWebPushSubscription.findFirst({
			where: { endpoint, user_id: userId, is_active: true },
			select: { id: true }
		});
		if (!callerSubscription) {
			return json({ success: false, error: 'Subscription not found' }, { status: 404 });
		}

		const subscriptions = await prisma.userWebPushSubscription.findMany({
			where: { user_id: userId, is_active: true },
			select: { id: true }
		});

		// Replace-all per user (cross-device). Drop every pending row of the
		// caller, then re-materialize `items × subscriptions` so the cron wakes
		// every signed-in device, not just the one that authored the change.
		// Already-sent rows are preserved so the retention sweep (D4) can audit
		// them. The same `(task_id, fire_at)` is recomputed identically on each
		// device, so replace-all from a different device converges to the same
		// set - no oscillation between writers.
		await prisma.$transaction(async (tx) => {
			await tx.pushSchedule.deleteMany({
				where: { user_id: userId, sent_at: null }
			});
			if (items.length > 0 && subscriptions.length > 0) {
				await tx.pushSchedule.createMany({
					data: subscriptions.flatMap((sub) =>
						items.map((item) => ({
							user_id: userId,
							subscription_id: sub.id,
							task_id: item.task_id,
							fire_at: new Date(item.fire_at)
						}))
					)
				});
			}
		});

		return json({ success: true, count: items.length, devices: subscriptions.length });
	} catch (error: unknown) {
		logger.error('Schedule POST error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		if (!notificationLimiter.check(userId)) {
			const retryAfter = notificationLimiter.retryAfter(userId);
			return json(
				{ success: false, error: 'Too many requests. Please try again later.' },
				{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
			);
		}

		const body = (await request.json()) as { task_id?: string };
		if (!body.task_id || typeof body.task_id !== 'string') {
			return json({ success: false, error: 'Missing task_id' }, { status: 400 });
		}

		const result = await prisma.pushSchedule.deleteMany({
			where: { user_id: userId, task_id: body.task_id, sent_at: null }
		});

		return json({ success: true, deleted: result.count });
	} catch (error: unknown) {
		logger.error('Schedule DELETE error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
