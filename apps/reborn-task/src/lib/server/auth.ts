import { verifyToken } from '@reborn/auth/server';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Task-API-Auth');

export interface TokenInfo {
  userId: string;
  sessionId?: string;
}

/**
 * Extract and verify the user ID from an Authorization: Bearer <token> header.
 * Returns null if the token is missing, malformed, or invalid.
 *
 * Only ACCESS tokens are accepted: a refresh token is also a validly signed
 * JWT (same issuer/audience, 30-day expiry) but bypasses rotation and
 * family-reuse revocation, so it must never authenticate data endpoints.
 */
export async function getUserFromToken(authorization: string | null): Promise<string | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyToken(authorization.slice(7), 'access');
    return payload?.userId ?? null;
  } catch (err: unknown) {
    logger.error('Token verification failed:', err);
    return null;
  }
}

/**
 * Extract user ID and session ID from an Authorization: Bearer <token> header.
 * Returns null if the token is missing, malformed, or invalid.
 * Access tokens only - see getUserFromToken.
 */
export async function getTokenInfo(authorization: string | null): Promise<TokenInfo | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyToken(authorization.slice(7), 'access');
    if (!payload?.userId) return null;
    return { userId: payload.userId, sessionId: payload.sessionId };
  } catch (err: unknown) {
    logger.error('Token verification failed:', err);
    return null;
  }
}
