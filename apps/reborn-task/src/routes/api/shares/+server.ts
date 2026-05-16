/**
 * POST /api/shares — create a SharedSnapshot for a single note.
 * GET  /api/shares — list shares owned by the authenticated user.
 *
 * Zero-knowledge contract:
 *   - Body fields payload_encrypted and owner_key_wrapped are opaque blobs.
 *     We validate their shape (Encryption Guard regex) but never decrypt.
 *   - password (if provided) is hashed Argon2id and stored as password_hash;
 *     the plaintext is discarded immediately.
 *   - Listing returns owner_key_wrapped so the owner can rebuild the URL on
 *     another device — that blob is useless without the master key.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import {
  CreateShareRequestSchema,
  SHARE_DEFAULT_EXPIRY_SECONDS,
  type CreateShareResponse,
  type OwnSharesListResponse,
  validateBody
} from '@reborn/types';
import { hashPassword } from '@reborn/crypto';
import { getUserFromToken } from '$lib/server/auth';
import { generateUniqueShareSlug } from '$lib/server/shares';
import { shareCreateLimiter } from '$lib/server/rate-limit';

const logger = createLogger('Task-API-Shares');

export const POST: RequestHandler = async (event) => {
  try {
    const userId = await getUserFromToken(event.request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Limiter keyed by userId (not IP): the endpoint is authenticated, so the
    // stable identity is the user, not the network path. See rate-limit.ts.
    if (!shareCreateLimiter.check(userId)) {
      const retryAfter = shareCreateLimiter.retryAfter(userId);
      return json(
        { success: false, error: 'Too many shares created. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const body = await event.request.json();
    const validation = validateBody(CreateShareRequestSchema, body);
    if (!validation.success) {
      return json(
        { success: false, error: validation.error, details: validation.details },
        { status: 400 }
      );
    }
    const { payload_encrypted, owner_key_wrapped, expires_in_seconds, password, max_access_count } =
      validation.data;

    const now = new Date();
    const effectiveExpiry =
      expires_in_seconds === undefined ? SHARE_DEFAULT_EXPIRY_SECONDS : expires_in_seconds;
    const expiresAt =
      effectiveExpiry === null ? null : new Date(now.getTime() + effectiveExpiry * 1000);

    const passwordHash = password ? await hashPassword(password) : null;
    const maxAccessCount = max_access_count ?? null;

    const slug = await generateUniqueShareSlug();

    const share = await prisma.sharedSnapshot.create({
      data: {
        user_id: userId,
        slug,
        snapshot_type: 'task',
        payload_encrypted,
        owner_key_wrapped,
        password_hash: passwordHash,
        expires_at: expiresAt,
        max_access_count: maxAccessCount
      },
      select: { id: true, slug: true, created_at: true, expires_at: true, max_access_count: true }
    });

    const response: CreateShareResponse = {
      id: share.id,
      slug: share.slug,
      created_at: share.created_at.toISOString(),
      expires_at: share.expires_at ? share.expires_at.toISOString() : null,
      max_access_count: share.max_access_count
    };
    return json({ success: true, data: response });
  } catch (err: unknown) {
    logger.error('POST /api/shares error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

export const GET: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Include 'unknown' legacy rows in both apps - client decrypts payload
    // and filters by the actual type from the ciphertext.
    const rows = await prisma.sharedSnapshot.findMany({
      where: { user_id: userId, snapshot_type: { in: ['task', 'unknown'] } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        slug: true,
        snapshot_type: true,
        owner_key_wrapped: true,
        payload_encrypted: true,
        password_hash: true,
        expires_at: true,
        created_at: true,
        last_accessed_at: true,
        access_count: true,
        max_access_count: true,
        revoked_at: true
      }
    });

    const data: OwnSharesListResponse = {
      shares: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        snapshot_type: (r.snapshot_type === 'note' || r.snapshot_type === 'task'
          ? r.snapshot_type
          : 'unknown') as 'note' | 'task' | 'unknown',
        owner_key_wrapped: r.owner_key_wrapped,
        payload_encrypted: r.payload_encrypted,
        has_password: r.password_hash !== null,
        expires_at: r.expires_at ? r.expires_at.toISOString() : null,
        created_at: r.created_at.toISOString(),
        last_accessed_at: r.last_accessed_at ? r.last_accessed_at.toISOString() : null,
        access_count: r.access_count,
        max_access_count: r.max_access_count,
        revoked_at: r.revoked_at ? r.revoked_at.toISOString() : null
      }))
    };
    return json({ success: true, data });
  } catch (err: unknown) {
    logger.error('GET /api/shares error:', err);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
