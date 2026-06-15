import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';
import { checkQuota } from '$lib/server/storage-quota';
import { apiErrorResponse } from '$lib/server/api-error';

const logger = createLogger('Notes-API-Notes');

/**
 * GET /api/notes — fetch all notes for the authenticated user.
 * Query params:
 *   folder_id  — filter by folder (use "null" for unorganised)
 *   include_archived=true — include trash
 *   since      — ISO timestamp: only notes updated after this date
 */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const folderId = url.searchParams.get('folder_id');
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    const since = url.searchParams.get('since');

    const where: Prisma.NoteWhereInput = { user_id: userId };
    if (!includeArchived) where.deleted_at = null;
    if (folderId === 'null') where.folder_id = null;
    else if (folderId) where.folder_id = folderId;
    if (since) where.updated_at = { gt: new Date(since) };

    const notes = await prisma.note.findMany({
      where,
      orderBy: { updated_at: 'desc' }
    });

    const data = notes.map((n) => ({
      id: n.id,
      folder_id: n.folder_id,
      title_encrypted: n.title_encrypted,
      content_encrypted: n.content_encrypted,
      excerpt_encrypted: n.excerpt_encrypted,
      metadata_encrypted: n.metadata_encrypted ?? undefined,
      is_archived: n.is_archived,
      deleted_at: n.deleted_at?.toISOString() ?? null,
      created_at: n.created_at.toISOString(),
      updated_at: n.updated_at.toISOString(),
      sync_version: n.sync_version
    }));

    return json({ success: true, data });
  } catch (err: unknown) {
    return apiErrorResponse(err, logger, 'GET /api/notes');
  }
};

/**
 * POST /api/notes — create a new note.
 * Body: { id, title_encrypted, content_encrypted, folder_id?, metadata_encrypted? }
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const validation = validateBody(schemas.CreateNoteRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const { id, title_encrypted, content_encrypted, folder_id, metadata_encrypted, created_at } =
      validation.data;

    if (folder_id) {
      const folder = await prisma.folder.findFirst({ where: { id: folder_id, user_id: userId } });
      if (!folder) return json({ success: false, error: 'Folder not found' }, { status: 404 });
    }

    // Check per-user storage quota
    const payloadSize = (title_encrypted?.length ?? 0) + (content_encrypted?.length ?? 0);
    const quota = await checkQuota(userId, payloadSize);
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

    // Ownership check: prevent overwriting another user's record
    const existingNote = await prisma.note.findUnique({ where: { id }, select: { user_id: true } });
    if (existingNote && existingNote.user_id !== userId) {
      return json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const note = await prisma.note.upsert({
      where: { id },
      create: {
        id,
        user_id: userId,
        folder_id: folder_id ?? null,
        title_encrypted,
        content_encrypted: content_encrypted ?? '',
        metadata_encrypted: metadata_encrypted ?? null,
        created_at: created_at ? new Date(created_at) : undefined,
        sync_version: 1
      },
      update: {
        title_encrypted,
        content_encrypted: content_encrypted ?? '',
        folder_id: folder_id ?? null,
        metadata_encrypted: metadata_encrypted ?? undefined,
        sync_version: { increment: 1 }
      }
    });

    return json({
      success: true,
      data: {
        id: note.id,
        created_at: note.created_at.toISOString(),
        updated_at: note.updated_at.toISOString(),
        sync_version: note.sync_version
      }
    });
  } catch (err: unknown) {
    return apiErrorResponse(err, logger, 'POST /api/notes');
  }
};
