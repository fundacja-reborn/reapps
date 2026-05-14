/**
 * GET /api/shares/[slug] — public read of an encrypted snapshot.
 *
 * NO authentication. Anyone with the URL fragment key can decrypt; password
 * (if set) is verified server-side, but capability lives in the URL fragment.
 *
 * Response shape (200):
 *   - { password_required: true } — caller must supply X-Share-Password header
 *   - { password_required: false, payload_encrypted, expires_at, created_at,
 *       access_count } — actual snapshot
 *
 * Errors:
 *   - 404 — slug not found
 *   - 410 Gone — revoked or expired
 *   - 401 — password supplied but wrong (also bumps authLimiter / IP)
 *   - 429 — too many requests
 *
 * Headers: Referrer-Policy: no-referrer + Cache-Control: no-store on every
 * response so that the fragment never leaks to third parties and no
 * intermediary caches the ciphertext.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { SlugSchema, type ShareViewResponse, type SharePasswordRequiredResponse } from '@reborn/types';
import { verifyPassword } from '@reborn/crypto';
import { getUserFromToken } from '$lib/server/auth';
import { sharePublicLimiter, authLimiter } from '$lib/server/rate-limit';
import { getClientIp } from '$lib/server/client-ip';

const logger = createLogger('Task-API-Share-View');

const NO_REFERRER_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store, no-cache, must-revalidate, private'
} as const;

function respond(body: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return json(body, {
    status,
    headers: { ...NO_REFERRER_HEADERS, ...extraHeaders }
  });
}

export const GET: RequestHandler = async (event) => {
  try {
    const ip = getClientIp(event);
    if (!sharePublicLimiter.check(ip)) {
      const retryAfter = sharePublicLimiter.retryAfter(ip);
      return respond(
        { success: false, error: 'Too many requests' },
        429,
        { 'Retry-After': String(retryAfter) }
      );
    }

    const rawSlug = event.params.slug;
    const slugParse = SlugSchema.safeParse(rawSlug);
    if (!slugParse.success) {
      return respond({ success: false, error: 'Not found' }, 404);
    }
    const slug = slugParse.data;

    const share = await prisma.sharedSnapshot.findUnique({
      where: { slug },
      select: {
        id: true,
        payload_encrypted: true,
        password_hash: true,
        expires_at: true,
        created_at: true,
        access_count: true,
        revoked_at: true
      }
    });

    if (!share) {
      return respond({ success: false, error: 'Not found' }, 404);
    }

    if (share.revoked_at) {
      return respond({ success: false, error: 'Share has been revoked' }, 410);
    }
    if (share.expires_at && share.expires_at < new Date()) {
      return respond({ success: false, error: 'Share has expired' }, 410);
    }

    // Password gate
    if (share.password_hash) {
      const provided = event.request.headers.get('x-share-password');
      if (!provided) {
        // Not auth failure — UX path: client renders password prompt.
        const body: SharePasswordRequiredResponse = { password_required: true };
        return respond({ success: true, data: body }, 200);
      }

      // Rate-limit password attempts per IP (reuse authLimiter shape).
      if (!authLimiter.check(ip)) {
        const retryAfter = authLimiter.retryAfter(ip);
        return respond(
          { success: false, error: 'Too many attempts' },
          429,
          { 'Retry-After': String(retryAfter) }
        );
      }

      const ok = await verifyPassword(provided, share.password_hash);
      if (!ok) {
        return respond({ success: false, error: 'Incorrect password' }, 401);
      }
    }

    // Success path — bump access counters (best-effort, do not block response).
    void prisma.sharedSnapshot
      .update({
        where: { id: share.id },
        data: { access_count: { increment: 1 }, last_accessed_at: new Date() }
      })
      .catch((err) => logger.error('Failed to bump access counters:', err));

    const data: ShareViewResponse = {
      password_required: false,
      payload_encrypted: share.payload_encrypted,
      expires_at: share.expires_at ? share.expires_at.toISOString() : null,
      created_at: share.created_at.toISOString(),
      access_count: share.access_count
    };
    return respond({ success: true, data }, 200);
  } catch (err: unknown) {
    logger.error('GET /api/shares/[slug] error:', err);
    return respond({ success: false, error: 'Internal server error' }, 500);
  }
};

/**
 * DELETE /api/shares/[slug] — owner revokes a share (soft delete).
 *
 * Auth required. Only the owner can revoke (user_id check). Revoked rows
 * remain for 24h grace period so other devices can show a "revoked" state
 * before the row is hard-deleted by `cleanupExpiredShares`.
 */
export const DELETE: RequestHandler = async (event) => {
  try {
    const userId = await getUserFromToken(event.request.headers.get('authorization'));
    if (!userId) return respond({ success: false, error: 'Unauthorized' }, 401);

    const slugParse = SlugSchema.safeParse(event.params.slug);
    if (!slugParse.success) {
      return respond({ success: false, error: 'Not found' }, 404);
    }

    const share = await prisma.sharedSnapshot.findUnique({
      where: { slug: slugParse.data },
      select: { id: true, user_id: true, revoked_at: true }
    });
    if (!share) return respond({ success: false, error: 'Not found' }, 404);
    if (share.user_id !== userId) {
      return respond({ success: false, error: 'Forbidden' }, 403);
    }

    if (!share.revoked_at) {
      await prisma.sharedSnapshot.update({
        where: { id: share.id },
        data: { revoked_at: new Date() }
      });
    }
    return respond({ success: true }, 200);
  } catch (err: unknown) {
    logger.error('DELETE /api/shares/[slug] error:', err);
    return respond({ success: false, error: 'Internal server error' }, 500);
  }
};
