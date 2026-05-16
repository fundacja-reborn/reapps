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
 *   - 401 — password supplied but wrong (also bumps sharePasswordLimiter / IP)
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
import {
  SlugSchema,
  type ShareViewResponse,
  type SharePasswordRequiredResponse,
  type ShareGoneCode
} from '@reborn/types';
import { verifyPassword } from '@reborn/crypto';
import { getUserFromToken } from '$lib/server/auth';
import { sharePublicLimiter, sharePasswordLimiter } from '$lib/server/rate-limit';
import { getClientIp } from '$lib/server/client-ip';

const logger = createLogger('Notes-API-Share-View');

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

function gone(error: string, code: ShareGoneCode) {
  return respond({ success: false, error, code }, 410);
}

/**
 * Atomically increment access counters with a max-access guard. Returns the
 * updated row (post-increment) or null when the share is exhausted / no longer
 * accessible. Auto-sets revoked_at when the limit is reached on this call so
 * the existing 24h grace + cleanup pipeline reclaims the row.
 *
 * The `WHERE` clause re-checks revoked / expired so a race with revoke/expiry
 * cannot leak a payload after invalidation.
 */
type IncrementResult = {
  payload_encrypted: string;
  expires_at: Date | null;
  created_at: Date;
  access_count: number;
  max_access_count: number | null;
};

async function incrementAccessAtomic(id: string): Promise<IncrementResult | null> {
  const rows = await prisma.$queryRaw<IncrementResult[]>`
    UPDATE "SharedSnapshot"
    SET access_count = access_count + 1,
        last_accessed_at = NOW(),
        revoked_at = CASE
          WHEN max_access_count IS NOT NULL
            AND access_count + 1 >= max_access_count
          THEN NOW()
          ELSE revoked_at
        END
    WHERE id = ${id}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (max_access_count IS NULL OR access_count < max_access_count)
    RETURNING payload_encrypted, expires_at, created_at, access_count, max_access_count
  `;
  return rows[0] ?? null;
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
        password_hash: true,
        expires_at: true,
        access_count: true,
        max_access_count: true,
        revoked_at: true
      }
    });

    if (!share) {
      return respond({ success: false, error: 'Not found' }, 404);
    }

    if (share.revoked_at) {
      return gone('Share has been revoked', 'REVOKED');
    }
    if (share.expires_at && share.expires_at < new Date()) {
      return gone('Share has expired', 'EXPIRED');
    }
    if (
      share.max_access_count !== null &&
      share.access_count >= share.max_access_count
    ) {
      return gone('Share has reached its access limit', 'EXHAUSTED');
    }

    // Password gate — verify before consuming an access slot. Wrong/missing
    // password must never burn through the access counter.
    if (share.password_hash) {
      const provided = event.request.headers.get('x-share-password');
      if (!provided) {
        // Not auth failure — UX path: client renders password prompt.
        const body: SharePasswordRequiredResponse = { password_required: true };
        return respond({ success: true, data: body }, 200);
      }

      // Rate-limit password attempts per IP. Dedicated limiter (not authLimiter)
      // so that brute-forcing a share password cannot exhaust the login limiter
      // for legitimate users behind the same NAT (and vice versa).
      if (!sharePasswordLimiter.check(ip)) {
        const retryAfter = sharePasswordLimiter.retryAfter(ip);
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

    // Atomic increment + guard. Returns null if a concurrent request consumed
    // the last slot, or revoked / expired the share between SELECT and UPDATE.
    const updated = await incrementAccessAtomic(share.id);
    if (!updated) {
      return gone('Share has reached its access limit', 'EXHAUSTED');
    }

    const data: ShareViewResponse = {
      password_required: false,
      payload_encrypted: updated.payload_encrypted,
      expires_at: updated.expires_at ? updated.expires_at.toISOString() : null,
      created_at: updated.created_at.toISOString(),
      access_count: updated.access_count,
      max_access_count: updated.max_access_count
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
