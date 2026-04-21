import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';
import { checkQuota } from '$lib/server/storage-quota';

const logger = createLogger('Notes-API-Note');

/** GET /api/notes/[id] — fetch a single note. */
export const GET: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const note = await prisma.note.findFirst({
      where: { id: params.id, user_id: userId }
    });
    if (!note) return json({ success: false, error: 'Not found' }, { status: 404 });

    return json({
      success: true,
      data: {
        id: note.id,
        folder_id: note.folder_id,
        title_encrypted: note.title_encrypted,
        content_encrypted: note.content_encrypted,
        metadata_encrypted: note.metadata_encrypted ?? undefined,
        is_archived: note.is_archived,
        deleted_at: note.deleted_at?.toISOString() ?? null,
        created_at: note.created_at.toISOString(),
        updated_at: note.updated_at.toISOString()
      }
    });
  } catch (err: unknown) {
    logger.error('GET /api/notes/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * PATCH /api/notes/[id] — update note fields.
 * Accepts any subset of: title_encrypted, content_encrypted, folder_id, metadata_encrypted
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.note.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: false, error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const validation = validateBody(schemas.UpdateNoteRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const data = validation.data;
    const updates: Prisma.NoteUncheckedUpdateInput = {};
    if (data.title_encrypted !== undefined) updates.title_encrypted = data.title_encrypted;
    if (data.content_encrypted !== undefined) updates.content_encrypted = data.content_encrypted;
    if ('folder_id' in data) {
      if (data.folder_id) {
        const folder = await prisma.folder.findFirst({
          where: { id: data.folder_id, user_id: userId }
        });
        if (!folder) return json({ success: false, error: 'Folder not found' }, { status: 404 });
      }
      updates.folder_id = data.folder_id ?? null;
    }
    if (data.metadata_encrypted !== undefined) updates.metadata_encrypted = data.metadata_encrypted;

    // Quota check: only when note grows (shrinking is always allowed)
    const newSize =
      (data.title_encrypted?.length ?? existing.title_encrypted.length) +
      (data.content_encrypted?.length ?? existing.content_encrypted.length);
    const oldSize = existing.title_encrypted.length + existing.content_encrypted.length;
    if (newSize > oldSize) {
      const delta = newSize - oldSize;
      const quota = await checkQuota(userId, delta);
      if (!quota.allowed) {
        return json(
          {
            success: false,
            error: 'QUOTA_EXCEEDED',
            used: quota.used,
            limit: quota.limit
          },
          { status: 413 }
        );
      }
    }

    const note = await prisma.note.update({
      where: { id: params.id },
      data: { ...updates, sync_version: existing.sync_version + 1 }
    });

    return json({
      success: true,
      data: { updated_at: note.updated_at.toISOString(), sync_version: note.sync_version }
    });
  } catch (err: unknown) {
    logger.error('PATCH /api/notes/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/** DELETE /api/notes/[id] — soft delete (move to trash). */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.note.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: true }); // idempotent — note already deleted

    const permanent = new URL(request.url).searchParams.get('permanent') === 'true';

    if (permanent) {
      await prisma.note.delete({ where: { id: params.id } });
      return json({ success: true });
    }

    // Soft-delete MUST bump sync_version so other devices pick up the archive
    // state on next pull. Without the bump the pull-side gate
    // `serverVersion <= localVersion` short-circuits and `is_archived` never
    // propagates across devices. See guideline 36 rule 11.e.
    const updated = await prisma.note.update({
      where: { id: params.id },
      data: { deleted_at: new Date(), sync_version: { increment: 1 } }
    });

    return json({
      success: true,
      data: {
        sync_version: updated.sync_version,
        updated_at: updated.updated_at.toISOString()
      }
    });
  } catch (err: unknown) {
    logger.error('DELETE /api/notes/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
