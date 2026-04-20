import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyPassword } from '@reborn/crypto';
import { prisma } from '@reborn/database';
import { getUserFromToken } from '$lib/server/auth';
import { deleteAccountLockout } from '$lib/server/rate-limit';

const logger = createLogger('Notes-DeleteAccount');

export const DELETE: RequestHandler = async ({ request, cookies }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (deleteAccountLockout.isLocked(userId)) {
      const retryAfter = deleteAccountLockout.retryAfter(userId);
      return json(
        { success: false, error: 'Too many failed attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const body = await request.json();
    const { password } = body ?? {};

    if (!password || typeof password !== 'string') {
      return json({ success: false, error: 'Password is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return json({ success: false, error: 'User not found' }, { status: 404 });

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      deleteAccountLockout.recordFailure(userId);
      return json({ success: false, error: 'Invalid password' }, { status: 400 });
    }

    // Delete user — all related data cascades (notes, folders, tags, sessions, tokens, etc.)
    await prisma.user.delete({ where: { id: userId } });

    logger.info(`Account deleted for user ${userId}`);

    // Clear auth cookies
    cookies.delete('access_token', { path: '/' });
    cookies.delete('refresh_token', { path: '/' });
    cookies.delete('session_id', { path: '/' });

    return json({ success: true });
  } catch (error: unknown) {
    logger.error('Delete account error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
