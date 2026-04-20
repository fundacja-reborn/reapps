import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { validateBody, schemas } from '@reborn/types';

const logger = createLogger('NotificationsSubscribe');

async function getUserId(authHeader: string | null): Promise<string | null> {
	const token = authHeader?.replace('Bearer ', '');
	if (!token) return null;
	try {
		const data = await verifyToken(token);
		return data?.userId ?? null;
	} catch {
		return null;
	}
}

/**
 * POST /api/notifications/subscribe
 * Save a Web Push subscription for the current user.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const body = await request.json();
		const validation = validateBody(schemas.WebPushSubscriptionSchema, body);
		if (!validation.success) {
			return json({ success: false, error: validation.error }, { status: 400 });
		}

		const { endpoint, keys, device_info_encrypted } = validation.data;

		// Ownership check: if subscription exists for another user, reject
		const existing = await prisma.userWebPushSubscription.findUnique({
			where: { endpoint },
			select: { user_id: true }
		});
		if (existing && existing.user_id !== userId) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		// Upsert by endpoint (same browser may re-subscribe)
		await prisma.userWebPushSubscription.upsert({
			where: { endpoint },
			create: {
				user_id: userId,
				endpoint,
				keys_encrypted: JSON.stringify(keys),
				device_info_encrypted: device_info_encrypted ?? null,
				is_active: true
			},
			update: {
				keys_encrypted: JSON.stringify(keys),
				device_info_encrypted: device_info_encrypted ?? null,
				is_active: true
			}
		});

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('Subscribe error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};

/**
 * DELETE /api/notifications/subscribe
 * Remove a Web Push subscription.
 */
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const body = (await request.json()) as { endpoint?: string };
		if (!body.endpoint) {
			return json({ success: false, error: 'Missing endpoint' }, { status: 400 });
		}

		await prisma.userWebPushSubscription.updateMany({
			where: { user_id: userId, endpoint: body.endpoint },
			data: { is_active: false }
		});

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('Unsubscribe error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
