import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-Folder');

/**
 * PATCH /api/folders/[id] — update folder name and/or parent.
 * Body: { name_encrypted?, parent_id?, order_index? }
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.folder.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: false, error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const validation = validateBody(schemas.UpdateFolderRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const data = validation.data;
    const updates: Prisma.FolderUncheckedUpdateInput = {};
    if (data.name_encrypted !== undefined) updates.name_encrypted = data.name_encrypted;
    if ('parent_id' in data) {
      if (data.parent_id) {
        // Prevent self-reference
        if (data.parent_id === params.id) {
          return json(
            { success: false, error: 'Folder cannot be its own parent' },
            { status: 400 }
          );
        }
        // Validate ownership
        const parentFolder = await prisma.folder.findFirst({
          where: { id: data.parent_id, user_id: userId }
        });
        if (!parentFolder) {
          return json({ success: false, error: 'Parent folder not found' }, { status: 404 });
        }
      }
      updates.parent_id = data.parent_id ?? null;
    }
    if (data.order_index !== undefined) updates.order_index = data.order_index;

    const folder = await prisma.folder.update({
      where: { id: params.id },
      data: { ...updates, sync_version: existing.sync_version + 1 }
    });

    return json({
      success: true,
      data: { updated_at: folder.updated_at.toISOString(), sync_version: folder.sync_version }
    });
  } catch (err: unknown) {
    logger.error('PATCH /api/folders/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * DELETE /api/folders/[id] — delete folder and cascade to children.
 *
 * Idempotent: if the folder does not exist (or belongs to another user) we
 * return 200 with `success: true` instead of 404. The client treats folder
 * deletes as fire-and-forget with a short 4-attempt retry window
 * (see `pushFolderDelete` in `notes-sync.service.ts`). A 404 — e.g. when the
 * folder was never synced because an earlier `pushFolder` was abandoned, or
 * the row was already removed by an earlier successful DELETE the client did
 * not record — would be retried 4× and then dropped permanently, even though
 * the desired end state (folder absent server-side) already holds. Returning
 * 200 on a missing row keeps the server view authoritative without leaking
 * existence: an unauthorised caller cannot distinguish "folder absent" from
 * "folder belongs to someone else".
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Ownership-scoped lookup. If the row is missing OR owned by a different
    // user, treat as a no-op success — same shape as DELETE /api/notes/[id].
    const existing = await prisma.folder.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: true });

    // Prisma cascade (onDelete: Cascade) handles child folders and notes
    await prisma.folder.delete({ where: { id: params.id } });

    return json({ success: true });
  } catch (err: unknown) {
    logger.error('DELETE /api/folders/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
