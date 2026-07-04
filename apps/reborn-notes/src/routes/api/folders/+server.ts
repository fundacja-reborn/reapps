import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-Folders');

// Row cap per user (audit 012 N2 unification - saved searches got theirs in
// PR #405; folders/tags shared the same pre-existing gap). Generous vs any
// real tree (the UI renders hundreds of folders fine, thousands are abuse).
const MAX_FOLDERS_PER_USER = 500;

/** GET /api/folders — fetch all folders for the authenticated user. */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const since = url.searchParams.get('since');
    // Unparseable `since` → 400, not an Invalid-Date Prisma 500 (audit 012 N8).
    if (since && Number.isNaN(Date.parse(since))) {
      return json({ success: false, error: 'Invalid since parameter' }, { status: 400 });
    }
    const where: Prisma.FolderWhereInput = { user_id: userId, is_archived: false };
    if (since) where.updated_at = { gt: new Date(since) };

    const folders = await prisma.folder.findMany({
      where,
      orderBy: [{ parent_id: 'asc' }, { order_index: 'asc' }]
    });

    const data = folders.map((f) => ({
      id: f.id,
      parent_id: f.parent_id,
      name_encrypted: f.name_encrypted,
      order_index: f.order_index,
      created_at: f.created_at.toISOString(),
      updated_at: f.updated_at.toISOString(),
      sync_version: f.sync_version
    }));

    return json({ success: true, data });
  } catch (err: unknown) {
    logger.error('GET /api/folders error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * POST /api/folders — create a new folder.
 * Body: { id, name_encrypted, parent_id? }
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const validation = validateBody(schemas.CreateFolderRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const { id, name_encrypted, parent_id, order_index } = validation.data;

    if (parent_id) {
      const parent = await prisma.folder.findFirst({ where: { id: parent_id, user_id: userId } });
      if (!parent)
        return json({ success: false, error: 'Parent folder not found' }, { status: 404 });
    }

    // Ownership check: prevent overwriting another user's record
    const existingFolder = await prisma.folder.findUnique({ where: { id }, select: { user_id: true } });
    if (existingFolder && existingFolder.user_id !== userId) {
      return json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Row cap applies to creates only - updates of existing rows stay allowed
    // (this POST is an upsert; a re-push of row #501 must not brick its edits).
    // 422 (not 5xx) so the client's push failure stays quiet: the row keeps
    // sync_status='pending' and retries once per periodic sync (cheap single
    // POST). Classifying 422 as a permanent rejection for folders/tags/saved
    // searches is a known gap (TODO P3) - the cap protects the server either way.
    if (!existingFolder) {
      const count = await prisma.folder.count({ where: { user_id: userId } });
      if (count >= MAX_FOLDERS_PER_USER) {
        return json(
          { success: false, error: 'FOLDER_LIMIT_EXCEEDED', limit: MAX_FOLDERS_PER_USER },
          { status: 422 }
        );
      }
    }

    const folder = await prisma.folder.upsert({
      where: { id },
      create: {
        id,
        user_id: userId,
        name_encrypted,
        parent_id: parent_id ?? null,
        order_index: order_index ?? 0,
        sync_version: 1
      },
      update: {
        name_encrypted,
        parent_id: parent_id ?? null,
        order_index: order_index ?? 0,
        sync_version: { increment: 1 }
      }
    });

    return json({
      success: true,
      data: {
        id: folder.id,
        created_at: folder.created_at.toISOString(),
        updated_at: folder.updated_at.toISOString(),
        sync_version: folder.sync_version
      }
    });
  } catch (err: unknown) {
    logger.error('POST /api/folders error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
