import { prisma, Prisma } from '@reborn/database';
import { DEFAULT_USER_STORAGE_LIMIT_BYTES } from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('StorageQuota');

export interface QuotaInfo {
  used: number;
  limit: number;
  percent: number;
}

export interface QuotaCheckResult extends QuotaInfo {
  allowed: boolean;
}

/**
 * Get configurable per-user storage limit from env (bytes).
 * Falls back to DEFAULT_USER_STORAGE_LIMIT_BYTES (100 MB).
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
 * Calculate total storage used by a user across notes and note versions (bytes).
 * Uses OCTET_LENGTH for accurate byte-level measurement of encrypted ciphertext.
 */
export async function getUserStorageBytes(userId: string): Promise<number> {
  try {
    const result = await prisma.$queryRaw<[{ total: bigint | null }]>(
      Prisma.sql`
        SELECT COALESCE(
          (SELECT SUM(OCTET_LENGTH("title_encrypted") + OCTET_LENGTH("content_encrypted"))
           FROM "Note" WHERE "user_id" = ${userId}),
          0
        ) + COALESCE(
          (SELECT SUM(OCTET_LENGTH("title_encrypted") + OCTET_LENGTH("content_encrypted"))
           FROM "NoteVersion" WHERE "user_id" = ${userId}),
          0
        ) AS total
      `
    );
    return Number(result[0]?.total ?? 0);
  } catch (err) {
    logger.error('Failed to calculate user storage:', err);
    return 0;
  }
}

/**
 * Get full quota info for a user.
 */
export async function getQuotaInfo(userId: string): Promise<QuotaInfo> {
  const used = await getUserStorageBytes(userId);
  const limit = getUserStorageLimit();
  return {
    used,
    limit,
    percent: limit > 0 ? Math.round((used / limit) * 100) : 0
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
