import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { getUserFromToken } from '$lib/server/auth';
import { apiErrorResponse } from '$lib/server/api-error';
import { z } from 'zod';

const logger = createLogger('Notes-API-Version');

const VersionIdSchema = z.string().uuid();

/**
 * DELETE /api/notes/[id]/versions/[versionId] - delete one version of a note (#521).
 *
 * Scoped to the note and the user, so a version id can never reach another
 * user's history. Idempotent: an unknown or already-deleted version succeeds
 * with `deleted: 0`. Other devices drop their local copy on their next history
 * pull (guideline 39).
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const parsed = VersionIdSchema.safeParse(params.versionId);
    if (!parsed.success) {
      return json({ success: false, error: 'Invalid version id' }, { status: 400 });
    }

    const { count } = await prisma.noteVersion.deleteMany({
      where: { id: parsed.data, note_id: params.id, user_id: userId }
    });

    return json({ success: true, deleted: count });
  } catch (err: unknown) {
    return apiErrorResponse(err, logger, 'DELETE /api/notes/[id]/versions/[versionId]');
  }
};
