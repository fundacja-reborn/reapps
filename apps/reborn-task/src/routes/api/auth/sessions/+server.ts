import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('Sessions');

async function getTokenInfo(
	authHeader: string | null
): Promise<{ userId: string; sessionId?: string } | null> {
	const token = authHeader?.replace('Bearer ', '');
	if (!token) return null;
	try {
		const data = await verifyToken(token, 'access');
		if (!data?.userId) return null;
		return { userId: data.userId, sessionId: data.sessionId };
	} catch {
		return null;
	}
}

/**
 * GET /api/auth/sessions
 * Returns list of active sessions for the current user
 */
export const GET: RequestHandler = async ({ request, cookies }) => {
	try {
		const info = await getTokenInfo(request.headers.get('authorization'));
		if (!info) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		// Use session_id cookie (set at login) — JWT sessionId is a random UUID that
		// never matches UserSession.id, so cookie is the reliable source.
		const currentSessionId = cookies.get('session_id') ?? null;

		const now = new Date();
		const sessions = await prisma.userSession.findMany({
			where: {
				user_id: info.userId,
				is_active: true,
				expires_at: { gt: now }
			},
			orderBy: { login_at: 'desc' },
			select: { id: true, login_at: true, expires_at: true, device_info_encrypted: true }
		});

		// Piggyback cleanup: remove expired/inactive sessions (non-blocking)
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		prisma.userSession
			.deleteMany({
				where: {
					user_id: info.userId,
					OR: [{ is_active: false, expires_at: { lt: now } }, { expires_at: { lt: thirtyDaysAgo } }]
				}
			})
			.then((result: { count: number }) => {
				if (result.count > 0)
					logger.info(`Cleaned up ${result.count} expired sessions for user ${info.userId}`);
			})
			.catch((err: unknown) => logger.debug('Session cleanup failed:', err));

		return json({ success: true, data: sessions, currentSessionId });
	} catch (error: unknown) {
		logger.error('Get sessions error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
