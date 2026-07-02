import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-SavedSearches');

/**
 * Hard cap on saved-search rows per user (audit 012 N2): SavedSearch sits
 * outside the byte-based storage quota, so without a cap an authenticated
 * client could grow the table without bound. 100 is far above real usage
 * (the UI lists them in a flat sidebar section).
 */
const MAX_SAVED_SEARCHES_PER_USER = 100;

/** GET /api/saved-searches — fetch all saved searches for the authenticated user. */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const since = url.searchParams.get('since');
    // Unparseable `since` → 400, not an Invalid-Date Prisma 500 (audit 012 N8).
    if (since && Number.isNaN(Date.parse(since))) {
      return json({ success: false, error: 'Invalid since parameter' }, { status: 400 });
    }
    const where: Prisma.SavedSearchWhereInput = { user_id: userId };
    if (since) where.updated_at = { gt: new Date(since) };

    const searches = await prisma.savedSearch.findMany({
      where,
      orderBy: { position: 'asc' }
    });

    const data = searches.map((s) => ({
      id: s.id,
      name_encrypted: s.name_encrypted,
      query_encrypted: s.query_encrypted,
      metadata_encrypted: s.metadata_encrypted,
      folder_id: s.folder_id,
      position: s.position,
      created_at: s.created_at.toISOString(),
      updated_at: s.updated_at.toISOString(),
      sync_version: s.sync_version
    }));

    return json({ success: true, data });
  } catch (err: unknown) {
    logger.error('GET /api/saved-searches error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * POST /api/saved-searches — create (or upsert by id) a saved search.
 * Body: { id, name_encrypted, query_encrypted, folder_id?, position?, created_at? }
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const validation = validateBody(schemas.CreateSavedSearchRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const { id, name_encrypted, query_encrypted, metadata_encrypted, folder_id, position, created_at } =
      validation.data;

    // Ownership check: prevent overwriting another user's record
    const existingSearch = await prisma.savedSearch.findUnique({
      where: { id },
      select: { user_id: true }
    });
    if (existingSearch && existingSearch.user_id !== userId) {
      return json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Row cap applies to creates only - updates of existing rows stay allowed.
    // 422 (not 5xx) so the offline push marks the item sync_error instead of
    // retrying forever.
    if (!existingSearch) {
      const count = await prisma.savedSearch.count({ where: { user_id: userId } });
      if (count >= MAX_SAVED_SEARCHES_PER_USER) {
        return json(
          {
            success: false,
            error: 'SAVED_SEARCH_LIMIT_EXCEEDED',
            limit: MAX_SAVED_SEARCHES_PER_USER
          },
          { status: 422 }
        );
      }
    }

    // Folder FK must exist and belong to the user. 404 lets the client push
    // degrade gracefully (retry without folder_id) when the folder was
    // deleted on another device while this search was parked offline.
    if (folder_id) {
      const folder = await prisma.folder.findFirst({
        where: { id: folder_id, user_id: userId },
        select: { id: true }
      });
      if (!folder) {
        return json({ success: false, error: 'Folder not found' }, { status: 404 });
      }
    }

    // Preserve the client-side creation timestamp (offline-first: the record
    // may have been created long before this push). Invalid dates fall back
    // to the server clock.
    const createdAt =
      created_at && !Number.isNaN(Date.parse(created_at)) ? new Date(created_at) : undefined;

    const search = await prisma.savedSearch.upsert({
      where: { id },
      create: {
        id,
        user_id: userId,
        name_encrypted,
        query_encrypted,
        metadata_encrypted: metadata_encrypted ?? null,
        folder_id: folder_id ?? null,
        position: position ?? 0,
        created_at: createdAt,
        sync_version: 1
      },
      update: {
        name_encrypted,
        query_encrypted,
        metadata_encrypted: metadata_encrypted ?? null,
        folder_id: folder_id ?? null,
        position: position ?? 0,
        sync_version: { increment: 1 }
      }
    });

    return json({
      success: true,
      data: {
        id: search.id,
        created_at: search.created_at.toISOString(),
        updated_at: search.updated_at.toISOString(),
        sync_version: search.sync_version
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('POST /api/saved-searches error:', { message: msg, name: (err as Error)?.name });
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
