import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken, blacklistAccessToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('Notes-LogoutAll');

export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    let userId: string | undefined;

    if (token) {
      try {
        const tokenData = await verifyToken(token, 'access');
        userId = tokenData?.userId;
      } catch {
        // Token might be expired but we still want to clear data
      }

      // Blacklist current access token for consistency with standard logout
      await blacklistAccessToken(token);
    }

    if (userId) {
      // Delete all refresh tokens for user
      await prisma.refreshToken.deleteMany({ where: { user_id: userId } });

      // Deactivate all user sessions
      await prisma.userSession.updateMany({
        where: { user_id: userId },
        data: { is_active: false }
      });

      logger.info(`Logged out all sessions for user ${userId}`);
    }

    // Clear the auth cookies on the current device. The access token is not one
    // of them: it lives in localStorage and is blacklisted above. (Audit 014 O67.)
    cookies.delete('refresh_token', { path: '/' });
    cookies.delete('session_id', { path: '/' });

    return json({ success: true });
  } catch (error: unknown) {
    logger.error('Logout-all error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
