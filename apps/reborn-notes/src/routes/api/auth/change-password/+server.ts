import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { hashPassword, verifyPassword } from '@reborn/crypto';
import { prisma } from '@reborn/database';
import {
  verifyToken,
  blacklistAccessToken,
  generateTokens,
  REFRESH_TOKEN_TTL_SECONDS,
  refreshTokenExpiryDate
} from '@reborn/auth/server';
import { changePasswordLockout } from '$lib/server/rate-limit';
import { isNativeClient } from '$lib/utils/native-client';

const logger = createLogger('Notes-ChangePassword');

export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const tokenData = await verifyToken(token, 'access');
    if (!tokenData?.userId) {
      return json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = tokenData.userId;

    // Rate limiting per userId
    const retryAfter = changePasswordLockout.retryAfter(userId);
    if (retryAfter > 0) {
      return json(
        { success: false, error: 'Too many attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const body = await request.json();
    const { currentPassword, newPassword, newEncryptedMasterKey, newMasterKeySalt } = body ?? {};

    if (!currentPassword || typeof currentPassword !== 'string' ||
        !newPassword || typeof newPassword !== 'string' ||
        !newEncryptedMasterKey || typeof newEncryptedMasterKey !== 'string' ||
        !newMasterKeySalt || typeof newMasterKeySalt !== 'string') {
      return json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      return json({ success: false, error: 'Password too short' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return json({ success: false, error: 'User not found' }, { status: 404 });

    const isValid = await verifyPassword(currentPassword, user.password_hash);
    if (!isValid) {
      changePasswordLockout.recordFailure(userId);
      return json({ success: false, error: 'Current password is incorrect' }, { status: 400 });
    }

    // Reset lockout on success
    changePasswordLockout.reset(userId);

    const newPasswordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password_hash: newPasswordHash,
        master_key_encrypted: newEncryptedMasterKey,
        master_key_salt: newMasterKeySalt,
        updated_at: new Date()
      }
    });

    // Invalidate all refresh tokens — force re-login on all devices
    await prisma.refreshToken.deleteMany({ where: { user_id: userId } });

    // Blacklist the current access token so it cannot be reused
    await blacklistAccessToken(token);

    // Generate a fresh token pair for the current session
    const newTokens = await generateTokens(userId, tokenData.sessionId);

    // Set new refresh token as httpOnly cookie
    cookies.set('refresh_token', newTokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_TTL_SECONDS,
      path: '/'
    });

    // Store the new refresh token in DB with a new token family
    await prisma.refreshToken.create({
      data: {
        token: newTokens.refreshToken,
        user_id: userId,
        family_id: crypto.randomUUID(),
        expires_at: refreshTokenExpiryDate()
      }
    });

    logger.info(`Password changed for user ${userId}`);
    const responseBody: Record<string, unknown> = { access_token: newTokens.accessToken };
    // change-password revokes ALL of the user's refresh tokens and issues a fresh
    // one, so a native client MUST receive the new token to re-persist in secure
    // storage - otherwise its stored token is dead and the next refresh fails.
    // Gated by the native header -> web stays byte-identical (cookie only).
    if (isNativeClient(request)) {
      responseBody.refresh_token = newTokens.refreshToken;
    }
    return json({ success: true, data: responseBody });
  } catch (error: unknown) {
    logger.error('Change password error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
