import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

/**
 * GET /api/notifications/vapid-public-key
 * Returns the VAPID public key for push subscription.
 * This key is public and does not require authentication.
 */
export const GET: RequestHandler = async () => {
	const publicKey = env.VAPID_PUBLIC_KEY;
	if (!publicKey || publicKey === 'your-vapid-public-key') {
		return json({ success: false, error: 'Push notifications not configured' }, { status: 503 });
	}
	return json({ success: true, publicKey });
};
