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
 */
export async function getUserFromToken(authorization: string | null): Promise<string | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyToken(authorization.slice(7));
    return payload?.userId ?? null;
  } catch (err: unknown) {
    logger.error('Token verification failed:', err);
    return null;
  }
}

/**
 * Extract user ID and session ID from an Authorization: Bearer <token> header.
 * Returns null if the token is missing, malformed, or invalid.
 */
export async function getTokenInfo(authorization: string | null): Promise<TokenInfo | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyToken(authorization.slice(7));
    if (!payload?.userId) return null;
    return { userId: payload.userId, sessionId: payload.sessionId };
  } catch (err: unknown) {
    logger.error('Token verification failed:', err);
    return null;
  }
}
