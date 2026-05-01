import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-Tag');

/**
 * PATCH /api/tags/[id] — update tag name and/or color.
 * Body: { name_encrypted?, color_encrypted? }
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.tag.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: false, error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const validation = validateBody(schemas.UpdateTagRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const data = validation.data;
    const updates: Prisma.TagUncheckedUpdateInput = {
      sync_version: existing.sync_version + 1
    };
    if (data.name_encrypted !== undefined) updates.name_encrypted = data.name_encrypted;
    if ('color_encrypted' in data) updates.color_encrypted = data.color_encrypted ?? null;

    const tag = await prisma.tag.update({ where: { id: params.id }, data: updates });

    return json({
      success: true,
      data: {
        updated_at: tag.updated_at.toISOString(),
        sync_version: tag.sync_version
      }
    });
  } catch (err: unknown) {
    logger.error('PATCH /api/tags/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * DELETE /api/tags/[id] — delete tag and all its note associations.
 *
 * Idempotent: missing tag returns 200 instead of 404. Same rationale as
 * `DELETE /api/folders/[id]` — `pushTagDelete` is fire-and-forget with a
 * 4-attempt retry budget, and a 404 on a tag that was never synced (or was
 * already removed) would burn that budget for nothing. Ownership check still
 * applies; a tag owned by another user is also treated as no-op success so
 * we don't leak existence.
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.tag.findFirst({ where: { id: params.id, user_id: userId } });
    if (!existing) return json({ success: true });

    // Tag-note associations are in metadata_encrypted (client-side) — no server-side join table
    await prisma.tag.delete({ where: { id: params.id } });

    return json({ success: true });
  } catch (err: unknown) {
    logger.error('DELETE /api/tags/[id] error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
