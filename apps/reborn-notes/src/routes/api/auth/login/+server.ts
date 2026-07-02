import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {
  handleLogin,
  createDefaultHandlerOptions,
  generateSingleUseToken,
  REFRESH_TOKEN_TTL_SECONDS,
  refreshTokenExpiryDate,
  TWO_FACTOR_CHALLENGE_PURPOSE,
  TWO_FACTOR_CHALLENGE_TTL_MINUTES
} from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { loginLockout } from '$lib/server/rate-limit';
import { isNativeClient } from '$lib/utils/native-client';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-Login');

/** Delete expired or inactive sessions older than 30 days (non-blocking, fire-and-forget). */
function cleanupExpiredSessions(userId: string): void {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  prisma.userSession
    .deleteMany({
      where: {
        user_id: userId,
        OR: [
          { is_active: false, expires_at: { lt: new Date() } },
          { expires_at: { lt: thirtyDaysAgo } }
        ]
      }
    })
    .then((result) => {
      if (result.count > 0)
        logger.info(`Cleaned up ${result.count} expired sessions for user ${userId}`);
    })
    .catch((err: unknown) => logger.debug('Session cleanup failed (non-critical):', err));
}

/**
 * POST /api/auth/login
 * Shared login endpoint for Reborn Notes.
 * Identical logic to reborn-task — both apps use the same PostgreSQL database.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const data = await request.json();

    // Input validation
    if (!data || typeof data !== 'object') {
      return json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { username, password } = data as Record<string, unknown>;
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return json({ error: 'Username is required' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length === 0) {
      return json({ error: 'Password is required' }, { status: 400 });
    }
    if (username.trim().length > 50 || password.length > 128) {
      return json({ error: 'Invalid credentials' }, { status: 400 });
    }

    // Per-username lockout check (before attempting login)
    if (loginLockout.isLocked(username)) {
      const retryAfter = loginLockout.retryAfter(username);
      return json(
        { success: false, error: 'Account temporarily locked. Too many failed attempts.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const handlerOptions = createDefaultHandlerOptions({
      user: prisma.user,
      refreshToken: prisma.refreshToken
    });

    const result = await handleLogin(data, handlerOptions);

    if (result.success && result.data) {
      // Check for 2FA
      if (result.data.user?.id) {
        const twoFactor = await prisma.twoFactorAuth.findUnique({
          where: { user_id: result.data.user.id, is_enabled: true }
        });

        if (twoFactor) {
          if (result.data.refreshToken) {
            await prisma.refreshToken.deleteMany({
              where: { token: result.data.refreshToken }
            });
          }
          // Short-lived challenge token binds /2fa/verify to this password-
          // verified login: the second factor cannot be attempted with a bare
          // userId (audit 012 S4).
          const challengeToken = await generateSingleUseToken(
            result.data.user.id,
            TWO_FACTOR_CHALLENGE_PURPOSE,
            TWO_FACTOR_CHALLENGE_TTL_MINUTES
          );
          return json({
            success: true,
            data: {
              twoFactorRequired: true,
              userId: result.data.user.id,
              challengeToken,
              encryptedMasterKey: result.data.encryptedMasterKey,
              masterKeySalt: result.data.masterKeySalt
            }
          });
        }
      }

      // Password verified, clear per-username lockout
      loginLockout.reset(username);

      if (!result.data.refreshToken) {
        return json({ error: 'Missing refresh token' }, { status: 500 });
      }

      cookies.set('refresh_token', result.data.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
        path: '/'
      });

      // Track session
      let nativeSessionId: string | undefined;
      if (result.data.user?.id) {
        try {
          const expiresAt = refreshTokenExpiryDate();
          const session = await prisma.userSession.create({
            data: {
              user_id: result.data.user.id,
              expires_at: expiresAt,
              device_info_encrypted: null,
              is_active: true
            }
          });

          // Native clients can't read the httpOnly session_id cookie below
          // (cross-site), so capture the id to hand back in the body.
          nativeSessionId = session.id;

          // Link the refresh token (created by handleLogin) to this session
          await prisma.refreshToken.updateMany({
            where: { token: result.data.refreshToken },
            data: { session_id: session.id }
          });

          cookies.set('session_id', session.id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: REFRESH_TOKEN_TTL_SECONDS,
            path: '/'
          });

          // Piggyback cleanup: remove expired sessions (non-blocking)
          cleanupExpiredSessions(result.data.user.id);
        } catch {
          // Non-critical
        }
      }

      const { refreshToken, accessToken, ...responseData } = result.data;
      const responseBody: Record<string, unknown> = {
        ...responseData,
        access_token: accessToken
      };
      // Native (Capacitor) client cannot use the httpOnly cookie cross-origin, so
      // it additionally receives the refresh token in the body to persist in secure
      // storage. Web clients send no native header -> response stays byte-identical
      // (refresh token only in the httpOnly cookie). See $lib/utils/native-client.
      if (isNativeClient(request)) {
        responseBody.refresh_token = refreshToken;
        // Native names its current session with this (device-info, list highlight).
        if (nativeSessionId) responseBody.session_id = nativeSessionId;
      }
      return json({ success: true, data: responseBody });
    } else {
      // Record failed login attempt for per-username lockout
      loginLockout.recordFailure(username);
      return json({ error: result.error }, { status: 401 });
    }
  } catch (error: unknown) {
    logger.error('Login endpoint error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
