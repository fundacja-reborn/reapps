import { prisma } from './client';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Find a non-expired idempotency key for the given user.
 * Returns the cached response if found, null otherwise.
 */
export async function findIdempotencyKey(
  key: string,
  userId: string
): Promise<{ response_status: number; response_body: string } | null> {
  const record = await prisma.idempotencyKey.findUnique({
    where: { key },
    select: { user_id: true, response_status: true, response_body: true, expires_at: true }
  });

  if (!record) return null;
  if (record.user_id !== userId) return null;
  if (record.expires_at < new Date()) return null;

  return { response_status: record.response_status, response_body: record.response_body };
}

/**
 * Store the response for an idempotency key. Uses upsert to handle race conditions.
 */
export async function storeIdempotencyResponse(
  key: string,
  userId: string,
  method: string,
  path: string,
  responseStatus: number,
  responseBody: string
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  await prisma.idempotencyKey.upsert({
    where: { key },
    create: {
      key,
      user_id: userId,
      method,
      path,
      response_status: responseStatus,
      response_body: responseBody,
      created_at: now,
      expires_at: expiresAt
    },
    update: {} // Don't overwrite if already stored (first response wins)
  });
}

/**
 * Delete expired idempotency keys. Called lazily (~1% of requests).
 */
export async function cleanupExpiredKeys(): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expires_at: { lt: new Date() } }
  });
  return result.count;
}
