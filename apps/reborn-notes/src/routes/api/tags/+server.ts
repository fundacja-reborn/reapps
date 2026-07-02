import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-API-Tags');

/** GET /api/tags — fetch all tags for the authenticated user. */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const since = url.searchParams.get('since');
    // Unparseable `since` → 400, not an Invalid-Date Prisma 500 (audit 012 N8).
    if (since && Number.isNaN(Date.parse(since))) {
      return json({ success: false, error: 'Invalid since parameter' }, { status: 400 });
    }
    const where: Prisma.TagWhereInput = { user_id: userId };
    if (since) where.updated_at = { gt: new Date(since) };

    const tags = await prisma.tag.findMany({ where, orderBy: { name_encrypted: 'asc' } });

    const data = tags.map((t) => ({
      id: t.id,
      name_encrypted: t.name_encrypted,
      color_encrypted: t.color_encrypted,
      created_at: t.created_at.toISOString(),
      updated_at: t.updated_at.toISOString(),
      sync_version: t.sync_version
    }));

    return json({ success: true, data });
  } catch (err: unknown) {
    logger.error('GET /api/tags error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * POST /api/tags — create a new tag.
 * Body: { id, name_encrypted, color_encrypted? }
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const validation = validateBody(schemas.CreateTagRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const { id, name_encrypted, color_encrypted } = validation.data;

    // Ownership check: prevent overwriting another user's record
    const existingTag = await prisma.tag.findUnique({ where: { id }, select: { user_id: true } });
    if (existingTag && existingTag.user_id !== userId) {
      return json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    let tag;
    try {
      tag = await prisma.tag.upsert({
        where: { id },
        create: {
          id,
          user_id: userId,
          name_encrypted,
          color_encrypted: color_encrypted ?? null,
          sync_version: 1
        },
        update: {
          name_encrypted,
          color_encrypted: color_encrypted ?? null,
          sync_version: { increment: 1 }
        }
      });
    } catch (upsertErr: unknown) {
      // Handle unique constraint violation on (user_id, name_encrypted).
      // This happens when import re-creates a tag with a new ID but the same
      // encrypted name already exists (e.g. the original tag was deleted by
      // ID, then the backup tries to push a tag with a different ID but the
      // same encrypted name — which another tag already owns).
      const prismaErr = upsertErr as { code?: string };
      if (prismaErr.code === 'P2002') {
        const existing = await prisma.tag.findFirst({
          where: { user_id: userId, name_encrypted }
        });
        if (existing) {
          tag = existing;
        } else {
          throw upsertErr;
        }
      } else {
        throw upsertErr;
      }
    }

    return json({
      success: true,
      data: {
        id: tag.id,
        created_at: tag.created_at.toISOString(),
        updated_at: tag.updated_at.toISOString(),
        sync_version: tag.sync_version
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('POST /api/tags error:', { message: msg, name: (err as Error)?.name });
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
