import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import {
  consumeSingleUseToken,
  generateTokens,
  REFRESH_TOKEN_TTL_SECONDS,
  refreshTokenExpiryDate,
  TWO_FACTOR_CHALLENGE_PURPOSE,
  verifySingleUseToken
} from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { v4 as uuidv4 } from 'uuid';
import * as OTPAuth from 'otpauth';
import { twoFactorLockout } from '$lib/server/rate-limit';
import { isNativeClient } from '$lib/utils/native-client';

const logger = createLogger('Notes-2FA-Verify');
const ISSUER = 'Reborn Apps';

/**
 * POST /api/auth/2fa/verify — Verify TOTP code during login (Reborn Notes)
 * Identical logic to reborn-task — both apps share the same user database.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const body = await request.json();
    const { challengeToken, code } = body ?? {};

    if (!challengeToken || typeof challengeToken !== 'string' || challengeToken.length > 2048) {
      return json({ success: false, error: 'Missing challenge token' }, { status: 400 });
    }
    if (!code || typeof code !== 'string' || code.length > 20) {
      return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
    }

    // The challenge token (issued by /login after a successful password step)
    // is the only accepted proof of identity here - a bare userId is not,
    // so the second factor cannot be attempted without the password
    // (audit 012 S4). Consumed only after a SUCCESSFUL code check below:
    // a typo in the TOTP must not force the user back to the password step.
    const challenge = await verifySingleUseToken(challengeToken, TWO_FACTOR_CHALLENGE_PURPOSE);
    if (!challenge) {
      return json({ success: false, error: 'Invalid or expired challenge' }, { status: 401 });
    }
    const userId = challenge.userId;

    // Per-userId lockout check
    if (twoFactorLockout.isLocked(userId)) {
      const retryAfter = twoFactorLockout.retryAfter(userId);
      return json(
        { success: false, error: 'Account temporarily locked. Too many failed attempts.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { twoFactorAuth: true }
    });

    if (!user || !user.twoFactorAuth?.is_enabled) {
      return json({ success: false, error: 'Invalid verification request' }, { status: 400 });
    }

    const trimmedCode = code.trim();
    const isRecoveryCode = trimmedCode.includes('-') || trimmedCode.length > 6;

    if (isRecoveryCode) {
      // Normalize same as generation: strip dashes, uppercase
      const crypto = await import('crypto');
      const normalized = trimmedCode.replace(/-/g, '').toUpperCase();
      const codeHash = crypto.createHash('sha256').update(normalized).digest('hex');
      const recoveryCode = await prisma.recoveryCode.findFirst({
        where: { user_id: userId, code_hash: codeHash, is_used: false }
      });
      if (!recoveryCode) {
        twoFactorLockout.recordFailure(userId);
        return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
      }
      await prisma.recoveryCode.update({
        where: { id: recoveryCode.id },
        data: { is_used: true, used_at: new Date() }
      });
      logger.info(`Recovery code used for 2FA, user ${userId}`);
    } else {
      if (trimmedCode.length !== 6) {
        return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
      }
      const totp = new OTPAuth.TOTP({
        issuer: ISSUER,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(user.twoFactorAuth.secret_server)
      });
      if (totp.validate({ token: trimmedCode, window: 1 }) === null) {
        twoFactorLockout.recordFailure(userId);
        return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
      }
    }

    // 2FA verified - consume the challenge (single-use) and clear lockout
    consumeSingleUseToken(challenge.jti, challenge.expiresAt);
    twoFactorLockout.reset(userId);

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(user.id);
    const expiresAt = refreshTokenExpiryDate();

    await prisma.refreshToken.create({
      data: { token: refreshToken, user_id: user.id, family_id: uuidv4(), expires_at: expiresAt }
    });

    cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_TTL_SECONDS,
      path: '/'
    });

    let nativeSessionId: string | undefined;
    try {
      const session = await prisma.userSession.create({
        data: {
          user_id: user.id,
          expires_at: expiresAt,
          device_info_encrypted: null,
          is_active: true
        }
      });

      // Native clients can't read the httpOnly session_id cookie below
      // (cross-site), so capture the id to hand back in the body.
      nativeSessionId = session.id;

      // Link the refresh token to this session
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { session_id: session.id }
      });

      cookies.set('session_id', session.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
        path: '/'
      });
    } catch {
      /* Non-critical */
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() }
    });

    logger.info(`2FA verification successful for user ${user.username}`);

    const responseBody: Record<string, unknown> = {
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at.toISOString()
      },
      encryptedMasterKey: user.master_key_encrypted,
      masterKeySalt: user.master_key_salt,
      access_token: accessToken
    };
    // Native (Capacitor) client persists the refresh token in secure storage (it
    // cannot use the httpOnly cookie cross-origin). Web clients send no native
    // header -> response stays byte-identical. See $lib/utils/native-client.
    if (isNativeClient(request)) {
      responseBody.refresh_token = refreshToken;
      // Native names its current session with this (device-info, list highlight).
      if (nativeSessionId) responseBody.session_id = nativeSessionId;
    }

    return json({ success: true, data: responseBody });
  } catch (error: unknown) {
    logger.error('2FA verify error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
