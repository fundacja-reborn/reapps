/**
 * POST /api/notifications/schedule
 *   Replace-all upsert of pending push schedules for the caller's subscription.
 *   Body: { endpoint, items: [{ task_id, fire_at }] }
 *   Behavior: inside one transaction, delete all unsent schedules for the
 *   subscription, then insert the new list. Idempotent - the client can re-sync
 *   on every task change without diffing.
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

		const subscription = await prisma.userWebPushSubscription.findFirst({
			where: { endpoint, user_id: userId, is_active: true },
			select: { id: true }
		});
		if (!subscription) {
			return json({ success: false, error: 'Subscription not found' }, { status: 404 });
		}

		const subscriptionId = subscription.id;

		// Replace-all: drop everything not yet sent, then re-insert. Already-sent
		// rows are preserved so the cron's retention sweep (D4) can audit them.
		await prisma.$transaction(async (tx) => {
			await tx.pushSchedule.deleteMany({
				where: { subscription_id: subscriptionId, sent_at: null }
			});
			if (items.length > 0) {
				await tx.pushSchedule.createMany({
					data: items.map((item) => ({
						user_id: userId,
						subscription_id: subscriptionId,
						task_id: item.task_id,
						fire_at: new Date(item.fire_at)
					}))
				});
			}
		});

		return json({ success: true, count: items.length });
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
