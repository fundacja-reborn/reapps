import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { verifyPassword } from '@reborn/crypto';
import { prisma } from '@reborn/database';
import { deleteAccountLockout } from '$lib/server/rate-limit';

const logger = createLogger('DeleteAccount');

export const DELETE: RequestHandler = async ({ request, cookies }) => {
	try {
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '');

		if (!token) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		let userId: string;
		try {
			const tokenData = await verifyToken(token, 'access');
			if (!tokenData?.userId) {
				return json({ success: false, error: 'Unauthorized' }, { status: 401 });
			}
			userId = tokenData.userId;
		} catch {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		if (deleteAccountLockout.isLocked(userId)) {
			const retryAfter = deleteAccountLockout.retryAfter(userId);
			return json(
				{ success: false, error: 'Too many failed attempts. Please try again later.' },
				{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
			);
		}

		const body = await request.json();
		const { password } = body;

		if (!password || typeof password !== 'string') {
			return json({ success: false, error: 'Password is required' }, { status: 400 });
		}

		// Verify password before deleting
		const userRecord = await prisma.user.findUnique({ where: { id: userId } });
		if (!userRecord) {
			return json({ success: false, error: 'User not found' }, { status: 404 });
		}

		const passwordValid = await verifyPassword(password, userRecord.password_hash);
		if (!passwordValid) {
			deleteAccountLockout.recordFailure(userId);
			return json({ success: false, error: 'Invalid password' }, { status: 400 });
		}

		// Delete user - all related data cascades (tasks, lists, sessions, tokens, etc.)
		await prisma.user.delete({ where: { id: userId } });

		logger.info(`Account deleted for user ${userId}`);

		// Clear the auth cookies. The access token is not one of them: it lives in
		// localStorage, and the account it authenticated no longer exists. (Audit 014 O67.)
		cookies.delete('refresh_token', { path: '/' });
		cookies.delete('session_id', { path: '/' });

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('Delete account error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
