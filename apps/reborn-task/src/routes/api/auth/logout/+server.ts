import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import {
	handleLogout,
	createDefaultHandlerOptions,
	verifyToken,
	NATIVE_SESSION_HEADER
} from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('AuthLogout');

/**
 * The refresh token a native shell sends in the body. The web client sends no
 * body (its token is the httpOnly cookie), so a missing or malformed body means
 * "no token", never an error: logout must not fail on it.
 */
async function readBodyRefreshToken(request: Request): Promise<string | undefined> {
	try {
		const body = (await request.json()) as { refresh_token?: unknown } | null;
		const token = body?.refresh_token;
		return typeof token === 'string' && token.length > 0 && token.length <= 2048
			? token
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * POST /api/auth/logout - end the session of THIS device only.
 *
 * Other devices keep their sessions; ending all of them is `/logout-all`. The
 * device names its session with what it holds. Web: the httpOnly `refresh_token`
 * and `session_id` cookies. Native: no cookie reaches this cross-site call, so the
 * shell sends its refresh token in the body and its session id in a header.
 */
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

		// Fallback: if token verification failed, try to identify user via session_id cookie.
		// Only the httpOnly cookie may name the user here: the native session-id
		// header is not a secret and only narrows an already authorised logout.
		const cookieSessionId = cookies.get('session_id');
		if (!userId && cookieSessionId) {
			try {
				const session = await prisma.userSession.findUnique({
					where: { id: cookieSessionId },
					select: { user_id: true }
				});
				if (session) {
					userId = session.user_id;
					logger.info('User identified via session_id cookie fallback');
				}
			} catch {
				logger.warn('Failed to look up session by cookie:', cookieSessionId);
			}
		}

		// End the session of THIS device only: the web names it with its httpOnly
		// cookies, a native shell with its body token and session header. Other
		// devices keep their sessions; ending all of them is /logout-all. With an
		// expired access token the refresh token alone still names the user.
		const sessionId = cookieSessionId ?? request.headers.get(NATIVE_SESSION_HEADER) ?? undefined;
		const refreshToken = cookies.get('refresh_token') ?? (await readBodyRefreshToken(request));
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
