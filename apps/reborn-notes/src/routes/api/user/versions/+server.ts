import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { getUserFromToken } from '$lib/server/auth';
import { apiErrorResponse } from '$lib/server/api-error';

const logger = createLogger('User-API-Versions');

/**
 * DELETE /api/user/versions - delete the version history of every note the user
 * owns (Settings > Data, #521). Frees the "History" share of the storage quota.
 *
 * Idempotent (`deleted: 0` when there is nothing left). Other devices drop their
 * local copies note by note, on their next history pull (guideline 39).
 */
export const DELETE: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { count } = await prisma.noteVersion.deleteMany({ where: { user_id: userId } });

    return json({ success: true, deleted: count });
  } catch (err: unknown) {
    return apiErrorResponse(err, logger, 'DELETE /api/user/versions');
  }
};
