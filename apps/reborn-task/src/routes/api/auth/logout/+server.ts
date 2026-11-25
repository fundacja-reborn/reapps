import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { handleLogout, createDefaultHandlerOptions, verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('AuthLogout');

export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		// Get token to identify user
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '');

		let userId: string | undefined;

		if (token) {
			try {
				const tokenData = await verifyToken(token, 'access');
				userId = tokenData?.userId;
			} catch (error: unknown) {
				// Token might be invalid, but we still want to clear cookies
				logger.warn('Invalid token during logout:', error);
			}
		}

		// Fallback: if token verification failed, try to identify user via session_id cookie
		const sessionId = cookies.get('session_id');
		if (!userId && sessionId) {
			try {
				const session = await prisma.userSession.findUnique({
					where: { id: sessionId },
					select: { user_id: true }
				});
				if (session) {
					userId = session.user_id;
					logger.info('User identified via session_id cookie fallback');
				}
			} catch {
				logger.warn('Failed to look up session by cookie:', sessionId);
			}
		}

		// End the session of THIS browser only, named by its httpOnly cookies.
		// Other devices keep their sessions; ending all of them is /logout-all.
		// With an expired access token the refresh token alone still names the user.
		const refreshToken = cookies.get('refresh_token');
		if (userId || refreshToken) {
			const result = await handleLogout(
				userId,
				createDefaultHandlerOptions({
					user: prisma.user,
					refreshToken: prisma.refreshToken
				}),
				token,
				{ refreshToken, sessionId }
			);

			if (!result.success || !result.data) {
				logger.warn('Logout handler failed:', result.error);
			} else if (result.data.sessionIds.length > 0) {
				// Deactivate the current UserSession
				try {
					await prisma.userSession.updateMany({
						where: { id: { in: result.data.sessionIds }, user_id: result.data.userId },
						data: { is_active: false }
					});
				} catch {
					logger.warn('Failed to deactivate session:', result.data.sessionIds);
				}
			}
		}

		// Clear the auth cookies regardless. The access token is not one of them:
		// it lives in localStorage (@reborn/auth auth-fetch), so logout revokes it
		// server-side instead of deleting it here. (Audit 014 O67.)
		cookies.delete('refresh_token', {
			path: '/'
		});

		cookies.delete('session_id', {
			path: '/'
		});

		logger.info('User logged out successfully');

		return json({
			success: true,
			message: 'Logged out successfully'
		});
	} catch (error: unknown) {
		logger.error('Logout error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
