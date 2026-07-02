import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';
import { checkQuota } from '$lib/server/storage-quota';
import { apiErrorResponse } from '$lib/server/api-error';

const logger = createLogger('Notes-API-Notes');

const DEFAULT_PAGE_LIMIT = 200;
const MAX_PAGE_LIMIT = 500;

type NoteRow = {
  id: string;
  folder_id: string | null;
  title_encrypted: string;
  content_encrypted: string;
  excerpt_encrypted: string | null;
  metadata_encrypted: string | null;
  is_archived: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  sync_version: number;
};

/** Wire shape for a single note. Identical for legacy and paginated responses. */
function serializeNote(n: NoteRow) {
  return {
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
  };
}

/**
 * Opaque keyset cursor over (updated_at, id). Both fields are already plaintext
 * in the server-visibility model, so this introduces no new plaintext - it is
 * just an encoding of the last row on a page. Not Prisma's `cursor:{id}`, which
 * breaks when the cursor row was hard-deleted between pages (real in delta sync).
 */
function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt.toISOString(), i: id })).toString('base64url');
}
function decodeCursor(raw: string): { updatedAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.u !== 'string' || typeof parsed?.i !== 'string') return null;
    const updatedAt = new Date(parsed.u);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * GET /api/notes — fetch notes for the authenticated user.
 *
 * Two modes, selected by whether the client sends pagination params:
 *   • Legacy (no `limit`/`cursor`): returns the full matching set, no `page`
 *     envelope. Keeps clients on older builds working unchanged (OTA paradox).
 *   • Paginated delta: keyset pagination over (updated_at ASC, id ASC). Returns
 *     one page + a `page` envelope { has_more, next_cursor, total?, all_ids? }.
 *
 * Query params:
 *   folder_id            — filter by folder ("null" for unorganised)
 *   include_archived=true — include trash (soft-deleted rows)
 *   since                — ISO timestamp: delta lower bound (inclusive, >=)
 *   cursor               — opaque keyset cursor (next page)
 *   limit                — page size (default 200, max 500)
 *   reconcile=true       — first page also returns all_ids (full id set) for
 *                          orphan-delete of notes hard-deleted on another device
 */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const folderId = url.searchParams.get('folder_id');
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    const since = url.searchParams.get('since');
    const cursorRaw = url.searchParams.get('cursor');
    const limitRaw = url.searchParams.get('limit');
    const wantReconcile = url.searchParams.get('reconcile') === 'true';
    const paginated = limitRaw !== null || cursorRaw !== null;

    // Unparseable `since` would reach Prisma as Invalid Date and 500; a 500
    // reads as transient to the sync client and would be retried forever
    // (audit 012 N8).
    if (since && Number.isNaN(Date.parse(since))) {
      return json({ success: false, error: 'Invalid since parameter' }, { status: 400 });
    }

    // Filter shared by the page query, the delta count and the all_ids scan.
    const baseWhere: Prisma.NoteWhereInput = { user_id: userId };
    if (!includeArchived) baseWhere.deleted_at = null;
    if (folderId === 'null') baseWhere.folder_id = null;
    else if (folderId) baseWhere.folder_id = folderId;

    // ── Legacy mode: old clients send neither limit nor cursor. ──────────
    if (!paginated) {
      const where: Prisma.NoteWhereInput = { ...baseWhere };
      if (since) where.updated_at = { gt: new Date(since) };
      const notes = await prisma.note.findMany({ where, orderBy: { updated_at: 'desc' } });
      return json({ success: true, data: notes.map(serializeNote) });
    }

    // ── Paginated delta mode ────────────────────────────────────────────
    const limit = Math.min(
      Math.max(parseInt(limitRaw ?? '', 10) || DEFAULT_PAGE_LIMIT, 1),
      MAX_PAGE_LIMIT
    );
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) {
      return json({ success: false, error: 'Invalid cursor' }, { status: 400 });
    }

    // The cursor (when present) is a strict keyset lower bound already past
    // `since`, so it supersedes it. The first page (no cursor) applies `since`
    // INCLUSIVELY (>=): boundary rows equal to the client watermark are re-sent
    // and no-op'd by the client's sync_version guard, so a row written at the
    // exact watermark instant is never missed.
    const pageWhere: Prisma.NoteWhereInput = { ...baseWhere };
    if (cursor) {
      pageWhere.OR = [
        { updated_at: { gt: cursor.updatedAt } },
        { updated_at: cursor.updatedAt, id: { gt: cursor.id } }
      ];
    } else if (since) {
      pageWhere.updated_at = { gte: new Date(since) };
    }

    // Peek one extra row to detect has_more without a second count.
    const rows = (await prisma.note.findMany({
      where: pageWhere,
      orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
      take: limit + 1
    })) as NoteRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.updated_at, last.id) : null;

    const page: {
      has_more: boolean;
      next_cursor: string | null;
      total?: number;
      all_ids?: string[];
    } = { has_more: hasMore, next_cursor: nextCursor };

    // First page only (no cursor): attach the delta total for a determinate
    // progress counter, and - when asked - the FULL id set for orphan reconcile.
    // all_ids ignores the since/cursor filter: it is every note row the user has.
    if (!cursor) {
      const deltaWhere: Prisma.NoteWhereInput = { ...baseWhere };
      if (since) deltaWhere.updated_at = { gte: new Date(since) };
      page.total = await prisma.note.count({ where: deltaWhere });
      if (wantReconcile) {
        const ids = await prisma.note.findMany({ where: baseWhere, select: { id: true } });
        page.all_ids = ids.map((r) => r.id);
      }
    }

    return json({ success: true, data: pageRows.map(serializeNote), page });
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
