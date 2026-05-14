import { prisma } from './client';

/**
 * Grace period kept after revoke before hard delete. Lets the UI show a
 * "revoked" state for clients that synced before the action.
 */
const REVOKE_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Delete shares that are no longer reachable: expired or revoked beyond the
 * grace period. Called lazily from hooks (~0.5% of requests) — no cron needed.
 */
export async function cleanupExpiredShares(): Promise<number> {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - REVOKE_GRACE_MS);

  const result = await prisma.sharedSnapshot.deleteMany({
    where: {
      OR: [
        { expires_at: { lt: now } },
        { revoked_at: { lt: graceCutoff } }
      ]
    }
  });
  return result.count;
}
