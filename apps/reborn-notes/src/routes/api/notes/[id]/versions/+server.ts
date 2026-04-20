import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { getUserFromToken } from '$lib/server/auth';
import { checkQuota } from '$lib/server/storage-quota';
import {
  MAX_NOTE_VERSIONS,
  MAX_ENCRYPTED_CONTENT_BYTES,
  MAX_ENCRYPTED_NOTE_TITLE_BYTES
} from '@reborn/types';
import { z } from 'zod';

const logger = createLogger('Notes-API-Versions');

/** GET /api/notes/[id]/versions — list all versions for a note (newest first). */
export const GET: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Verify note ownership
    const note = await prisma.note.findFirst({
      where: { id: params.id, user_id: userId },
      select: { id: true }
    });
    if (!note) return json({ success: false, error: 'Not found' }, { status: 404 });

    const versions = await prisma.noteVersion.findMany({
      where: { note_id: params.id, user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        note_id: true,
        title_encrypted: true,
        content_encrypted: true,
        created_at: true
      }
    });

    return json({
      success: true,
      data: versions.map((v) => ({
        id: v.id,
        note_id: v.note_id,
        title_encrypted: v.title_encrypted,
        content_encrypted: v.content_encrypted,
        created_at: v.created_at.toISOString()
      }))
    });
  } catch (err: unknown) {
    logger.error('GET /api/notes/[id]/versions error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

const NoteVersionBodySchema = z.object({
  id: z.string().uuid(),
  title_encrypted: z.string().min(1).max(MAX_ENCRYPTED_NOTE_TITLE_BYTES),
  content_encrypted: z.string().min(1).max(MAX_ENCRYPTED_CONTENT_BYTES),
  created_at: z.string().datetime().optional()
});

/** POST /api/notes/[id]/versions — create or upsert a version. Prunes to MAX_NOTE_VERSIONS per note. */
export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Verify note ownership
    const note = await prisma.note.findFirst({
      where: { id: params.id, user_id: userId },
      select: { id: true }
    });
    if (!note) return json({ success: false, error: 'Not found' }, { status: 404 });

    const body = await request.json();
    const parsed = NoteVersionBodySchema.safeParse(body);
    if (!parsed.success) {
      return json(
        { success: false, error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { id, title_encrypted, content_encrypted, created_at } = parsed.data;

    // Check per-user storage quota before adding version
    const versionSize = title_encrypted.length + content_encrypted.length;
    const quota = await checkQuota(userId, versionSize);
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

    // Ownership check: prevent overwriting another user's version
    const existingVersion = await prisma.noteVersion.findUnique({ where: { id }, select: { user_id: true } });
    if (existingVersion && existingVersion.user_id !== userId) {
      return json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Upsert version
    await prisma.noteVersion.upsert({
      where: { id },
      create: {
        id,
        note_id: params.id,
        user_id: userId,
        title_encrypted,
        content_encrypted,
        created_at: created_at ? new Date(created_at) : new Date()
      },
      update: {
        title_encrypted,
        content_encrypted
      }
    });

    // Prune: keep only the most recent MAX_NOTE_VERSIONS
    const allVersions = await prisma.noteVersion.findMany({
      where: { note_id: params.id },
      orderBy: { created_at: 'desc' },
      select: { id: true }
    });

    if (allVersions.length > MAX_NOTE_VERSIONS) {
      const toDelete = allVersions.slice(MAX_NOTE_VERSIONS).map((v) => v.id);
      await prisma.noteVersion.deleteMany({ where: { id: { in: toDelete } } });
    }

    return json({ success: true });
  } catch (err: unknown) {
    logger.error('POST /api/notes/[id]/versions error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/** DELETE /api/notes/[id]/versions — delete all versions for a note. */
export const DELETE: RequestHandler = async ({ request, params }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    await prisma.noteVersion.deleteMany({
      where: { note_id: params.id, user_id: userId }
    });

    return json({ success: true });
  } catch (err: unknown) {
    logger.error('DELETE /api/notes/[id]/versions error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
