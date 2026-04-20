import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { prisma } from '@reborn/database';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-SessionDelete');

/** DELETE /api/auth/sessions/:id — revoke a specific session */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = params;
    if (!id || typeof id !== 'string' || id.length > 36) {
      return json({ success: false, error: 'Invalid session id' }, { status: 400 });
    }

    await prisma.userSession.updateMany({
      where: { id, user_id: userId },
      data: { is_active: false }
    });

    // Delete linked refresh tokens so the revoked device can no longer refresh
    await prisma.refreshToken.deleteMany({
      where: { session_id: id }
    });

    logger.info(`Session ${id} revoked for user ${userId}`);
    return json({ success: true });
  } catch (error: unknown) {
    logger.error('Delete session error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
