import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-SavedSearch');

/**
 * PATCH /api/saved-searches/[id] — update name, query, folder parking and/or position.
 * Body: { name_encrypted?, query_encrypted?, folder_id?, position? }
 * `folder_id: null` explicitly unparks the search from the folder tree.
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.savedSearch.findFirst({
      where: { id: params.id, user_id: userId }
    });
    if (!existing) return json({ success: false, error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const validation = validateBody(schemas.UpdateSavedSearchRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const data = validation.data;

    // Folder FK must exist and belong to the user (404 → client push degrades
    // to folder_id: null, same contract as POST).
    if (data.folder_id) {
      const folder = await prisma.folder.findFirst({
        where: { id: data.folder_id, user_id: userId },
        select: { id: true }
      });
      if (!folder) {
        return json({ success: false, error: 'Folder not found' }, { status: 404 });
      }
    }

    const updates: Prisma.SavedSearchUncheckedUpdateInput = {
      sync_version: existing.sync_version + 1
    };
    if (data.name_encrypted !== undefined) updates.name_encrypted = data.name_encrypted;
    if (data.query_encrypted !== undefined) updates.query_encrypted = data.query_encrypted;
    if ('folder_id' in data) updates.folder_id = data.folder_id ?? null;
    if (data.position !== undefined) updates.position = data.position;

    const search = await prisma.savedSearch.update({ where: { id: params.id }, data: updates });

    return json({
      success: true,
      data: {
        updated_at: search.updated_at.toISOString(),
        sync_version: search.sync_version
      }
    });
  } catch (err: unknown) {
    logger.error('PATCH /api/saved-searches/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * DELETE /api/saved-searches/[id] — delete a saved search.
 *
 * Idempotent: missing search returns 200 instead of 404. Same rationale as
 * `DELETE /api/tags/[id]` — `pushSavedSearchDelete` is fire-and-forget with a
 * 4-attempt retry budget, and a 404 on a search that was never synced (or was
 * already removed) would burn that budget for nothing. Ownership check still
 * applies; a search owned by another user is also treated as no-op success so
 * we don't leak existence.
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.savedSearch.findFirst({
      where: { id: params.id, user_id: userId }
    });
    if (!existing) return json({ success: true });

    await prisma.savedSearch.delete({ where: { id: params.id } });

    return json({ success: true });
  } catch (err: unknown) {
    logger.error('DELETE /api/saved-searches/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
