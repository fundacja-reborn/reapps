/**
 * In-memory token blacklist for access token revocation
 *
 * Stores JTIs (JWT IDs) of revoked tokens with their expiration time.
 * Entries are automatically cleaned up after token expiry to prevent memory leaks.
 * Access tokens have 15-min TTL, so blacklist entries live at most 15 minutes.
 */

import { createLogger } from '@reborn/utils';

const logger = createLogger('TokenBlacklist');

/** Map of JTI → expiration timestamp (seconds since epoch) */
const blacklist = new Map<string, number>();

/** Cleanup interval handle */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Cleanup runs every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Add a token to the blacklist
 * @param jti - JWT ID of the token to blacklist
 * @param expiresAt - Token expiration timestamp (seconds since epoch)
 */
export function blacklistToken(jti: string, expiresAt: number): void {
  blacklist.set(jti, expiresAt);
  logger.debug('Token blacklisted:', { jti, expiresAt });
  ensureCleanupRunning();
}

/**
 * Check if a token is blacklisted
 * @param jti - JWT ID to check
 * @returns true if the token is blacklisted and not yet expired
 */
export function isTokenBlacklisted(jti: string): boolean {
  const expiresAt = blacklist.get(jti);
  if (expiresAt === undefined) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now >= expiresAt) {
    // Token already expired — remove from blacklist
    blacklist.delete(jti);
    return false;
  }

  return true;
}

/**
 * Remove expired entries from the blacklist
 */
export function cleanupExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  let removed = 0;

  for (const [jti, expiresAt] of blacklist) {
    if (now >= expiresAt) {
      blacklist.delete(jti);
      removed++;
    }
  }

  if (removed > 0) {
    logger.debug(`Cleaned up ${removed} expired blacklist entries, ${blacklist.size} remaining`);
  }

  if (blacklist.size === 0) {
    stopCleanup();
  }
}

/**
 * Get the current size of the blacklist (for monitoring)
 */
export function getBlacklistSize(): number {
  return blacklist.size;
}

/**
 * Clear the entire blacklist (for testing)
 */
export function clearBlacklist(): void {
  blacklist.clear();
  stopCleanup();
}

function ensureCleanupRunning(): void {
  if (cleanupInterval === null) {
    cleanupInterval = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
    // Allow process to exit even if interval is running
    if (typeof cleanupInterval === 'object' && 'unref' in cleanupInterval) {
      cleanupInterval.unref();
    }
  }
}

function stopCleanup(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
