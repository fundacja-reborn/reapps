import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-Restore');

/** POST /api/notes/[id]/restore — restore note from trash. */
export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.note.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: false, error: 'Not found' }, { status: 404 });

    await prisma.note.update({ where: { id: params.id }, data: { deleted_at: null } });

    return json({ success: true });
  } catch (err: unknown) {
    logger.error('POST /api/notes/[id]/restore error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
