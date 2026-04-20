import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { handleSession, createDefaultHandlerOptions } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('AuthSession');

export const GET: RequestHandler = async ({ request, cookies }) => {
	try {
		// Get token from Authorization header or cookie
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '') || cookies.get('access_token');

		if (!token) {
			return json({ success: false, error: 'No session found' }, { status: 401 });
		}

		// Use handler from @reborn/auth
		const result = await handleSession(
			token,
			createDefaultHandlerOptions({
				user: prisma.user,
				refreshToken: prisma.refreshToken
			})
		);

		if (result.success && result.data) {
			return json({
				success: true,
				data: {
					user: result.data
				}
			});
		} else {
			return json({ success: false, error: result.error || 'Invalid session' }, { status: 401 });
		}
	} catch (error: unknown) {
		logger.error('Session error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
