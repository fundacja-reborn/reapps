import { prisma, Prisma } from '@reborn/database';
import { DEFAULT_USER_STORAGE_LIMIT_BYTES } from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('StorageQuota');

export interface QuotaBreakdown {
  /** Bytes from Note rows (title_encrypted + content_encrypted). */
  notes: number;
  /** Bytes from NoteVersion rows (title_encrypted + content_encrypted). */
  versions: number;
  /** Bytes from active SharedSnapshot rows (note-type, not revoked). */
  shares: number;
}

export interface QuotaInfo {
  used: number;
  limit: number;
  percent: number;
  breakdown: QuotaBreakdown;
}

export interface QuotaCheckResult extends QuotaInfo {
  allowed: boolean;
}

/**
 * Get configurable per-user storage limit from env (bytes).
 * Falls back to DEFAULT_USER_STORAGE_LIMIT_BYTES (50 MB).
 */
export function getUserStorageLimit(): number {
  const envValue = process.env.USER_STORAGE_LIMIT_BYTES;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_USER_STORAGE_LIMIT_BYTES;
}

/**
 * Calculate per-component storage used by a user (bytes). Counts notes,
 * note versions, and active (non-revoked) note-typed shared snapshots. Task
 * shares are intentionally excluded - the Task app has no quota system, so
 * folding them into the Notes quota would be confusing for users.
 *
 * Revoked shares are excluded because revoke is an explicit user action to
 * release the slot - even though the row lingers for 24h grace before
 * `cleanupExpiredShares` hard-deletes it.
 */
export async function getUserStorageBreakdown(userId: string): Promise<QuotaBreakdown> {
  try {
    const result = await prisma.$queryRaw<
      [{ notes: bigint | null; versions: bigint | null; shares: bigint | null }]
    >(
      Prisma.sql`
        SELECT
          COALESCE(
            (SELECT SUM(OCTET_LENGTH("title_encrypted") + OCTET_LENGTH("content_encrypted"))
             FROM "Note" WHERE "user_id" = ${userId}),
            0
          )::bigint AS notes,
          COALESCE(
            (SELECT SUM(OCTET_LENGTH("title_encrypted") + OCTET_LENGTH("content_encrypted"))
             FROM "NoteVersion" WHERE "user_id" = ${userId}),
            0
          )::bigint AS versions,
          COALESCE(
            (SELECT SUM(OCTET_LENGTH("payload_encrypted"))
             FROM "SharedSnapshot"
             WHERE "user_id" = ${userId}
               AND "snapshot_type" = 'note'
               AND "revoked_at" IS NULL),
            0
          )::bigint AS shares
      `
    );
    const row = result[0];
    return {
      notes: Number(row?.notes ?? 0),
      versions: Number(row?.versions ?? 0),
      shares: Number(row?.shares ?? 0)
    };
  } catch (err) {
    logger.error('Failed to calculate user storage breakdown:', err);
    return { notes: 0, versions: 0, shares: 0 };
  }
}

/**
 * Total storage used by a user (bytes). Kept as a thin wrapper around
 * the breakdown so callers that only need the total don't have to think
 * about components.
 */
export async function getUserStorageBytes(userId: string): Promise<number> {
  const b = await getUserStorageBreakdown(userId);
  return b.notes + b.versions + b.shares;
}

/**
 * Get full quota info for a user.
 */
export async function getQuotaInfo(userId: string): Promise<QuotaInfo> {
  const breakdown = await getUserStorageBreakdown(userId);
  const used = breakdown.notes + breakdown.versions + breakdown.shares;
  const limit = getUserStorageLimit();
  return {
    used,
    limit,
    percent: limit > 0 ? Math.round((used / limit) * 100) : 0,
    breakdown
  };
}

/**
 * Check whether a user can store additional bytes without exceeding quota.
 * Returns quota info + allowed flag.
 */
export async function checkQuota(
  userId: string,
  additionalBytes: number
): Promise<QuotaCheckResult> {
  const info = await getQuotaInfo(userId);
  return {
    ...info,
    allowed: info.used + additionalBytes <= info.limit
  };
}
