import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('SessionRevoke');

export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const token = request.headers.get('authorization')?.replace('Bearer ', '');
		if (!token) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const tokenData = await verifyToken(token, 'access');
		if (!tokenData?.userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const sessionId = params.id;

		// Verify session belongs to user
		const session = await prisma.userSession.findFirst({
			where: { id: sessionId, user_id: tokenData.userId }
		});

		if (!session) {
			return json({ success: false, error: 'Session not found' }, { status: 404 });
		}

		// Deactivate session
		await prisma.userSession.update({
			where: { id: sessionId },
			data: { is_active: false }
		});

		// Delete linked refresh tokens so the revoked device can no longer refresh
		await prisma.refreshToken.deleteMany({
			where: { session_id: sessionId }
		});

		logger.info(`Session ${sessionId} revoked for user ${tokenData.userId}`);

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('Session revoke error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
