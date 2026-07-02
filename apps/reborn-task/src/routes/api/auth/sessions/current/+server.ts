import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('SessionPatchCurrent');

const MAX_DEVICE_INFO_ENCRYPTED_BYTES = 512;

/**
 * PATCH /api/auth/sessions/current
 * Update the current session's device_info_encrypted field.
 * Called by the client after E2E unlock — encrypts parsed UA and sends cipher.
 */
export const PATCH: RequestHandler = async ({ request, cookies }) => {
	try {
		const token = request.headers.get('authorization')?.replace('Bearer ', '');
		if (!token) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const tokenData = await verifyToken(token, 'access');
		if (!tokenData?.userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const sessionId = cookies.get('session_id');
		if (!sessionId) return json({ success: false, error: 'No active session' }, { status: 400 });

		const body = await request.json();
		const deviceInfoEncrypted = body?.device_info_encrypted;
		if (!deviceInfoEncrypted || typeof deviceInfoEncrypted !== 'string') {
			return json({ success: false, error: 'Missing device_info_encrypted' }, { status: 400 });
		}
		if (deviceInfoEncrypted.length > MAX_DEVICE_INFO_ENCRYPTED_BYTES) {
			return json({ success: false, error: 'device_info_encrypted too large' }, { status: 400 });
		}

		// Verify session belongs to user and is active
		const session = await prisma.userSession.findFirst({
			where: { id: sessionId, user_id: tokenData.userId, is_active: true }
		});

		if (!session) {
			return json({ success: false, error: 'Session not found' }, { status: 404 });
		}

		await prisma.userSession.update({
			where: { id: sessionId },
			data: { device_info_encrypted: deviceInfoEncrypted }
		});

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('Patch session error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
