import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { prisma } from '@reborn/database';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-SessionPatchCurrent');

/**
 * PATCH /api/auth/sessions/current
 * Update the current session's device_info_encrypted field.
 * Called by the client after E2E unlock — encrypts parsed UA and sends cipher.
 */
export const PATCH: RequestHandler = async ({ request, cookies }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const sessionId = cookies.get('session_id');
    if (!sessionId) return json({ success: false, error: 'No active session' }, { status: 400 });

    const body = await request.json();
    const deviceInfoEncrypted = body?.device_info_encrypted;
    if (!deviceInfoEncrypted || typeof deviceInfoEncrypted !== 'string') {
      return json({ success: false, error: 'Missing device_info_encrypted' }, { status: 400 });
    }

    // Verify session belongs to user and is active
    const session = await prisma.userSession.findFirst({
      where: { id: sessionId, user_id: userId, is_active: true }
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
