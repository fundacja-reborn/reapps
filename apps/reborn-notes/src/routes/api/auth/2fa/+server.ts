import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyPassword } from '@reborn/crypto';
import { prisma } from '@reborn/database';
import { getUserFromToken } from '$lib/server/auth';
import * as OTPAuth from 'otpauth';
import { twoFactorDisableLockout } from '$lib/server/rate-limit';

const logger = createLogger('Notes-2FA-API');
const ISSUER = 'Reborn Apps';

/**
 * GET /api/auth/2fa — Check 2FA status
 */
export const GET: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const twoFactor = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId }
    });

    return json({
      success: true,
      data: {
        isEnabled: twoFactor?.is_enabled ?? false,
        createdAt: twoFactor?.created_at?.toISOString() ?? null
      }
    });
  } catch (error: unknown) {
    logger.error('2FA status check error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * POST /api/auth/2fa — Setup 2FA (generate secret + URI)
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const existing = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId }
    });

    if (existing?.is_enabled) {
      return json({ success: false, error: '2FA is already enabled' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    });

    if (!user) {
      return json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const secret = new OTPAuth.Secret({ size: 20 });

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: user.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret
    });

    const otpauthUri = totp.toString();
    const secretBase32 = secret.base32;

    await prisma.twoFactorAuth.upsert({
      where: { user_id: userId },
      update: {
        secret_server: secretBase32,
        secret_encrypted: '',
        is_enabled: false
      },
      create: {
        user_id: userId,
        secret_server: secretBase32,
        secret_encrypted: '',
        is_enabled: false
      }
    });

    logger.info(`2FA setup initiated for user ${userId}`);

    return json({
      success: true,
      data: {
        secret: secretBase32,
        otpauthUri,
        issuer: ISSUER,
        username: user.username
      }
    });
  } catch (error: unknown) {
    logger.error('2FA setup error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * PUT /api/auth/2fa — Verify code and enable 2FA
 */
export const PUT: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { code, secretEncrypted } = body;

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
    }

    const twoFactor = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId }
    });

    if (!twoFactor) {
      return json(
        { success: false, error: '2FA setup not found. Start setup first.' },
        { status: 400 }
      );
    }

    if (twoFactor.is_enabled) {
      return json({ success: false, error: '2FA is already enabled' }, { status: 400 });
    }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(twoFactor.secret_server)
    });

    const delta = totp.validate({ token: code, window: 1 });

    if (delta === null) {
      return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
    }

    await prisma.twoFactorAuth.update({
      where: { user_id: userId },
      data: {
        is_enabled: true,
        secret_encrypted: secretEncrypted || ''
      }
    });

    logger.info(`2FA enabled for user ${userId}`);

    return json({ success: true });
  } catch (error: unknown) {
    logger.error('2FA verify-setup error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * DELETE /api/auth/2fa — Disable 2FA (requires password)
 */
export const DELETE: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const retryAfter = twoFactorDisableLockout.retryAfter(userId);
    if (retryAfter > 0) {
      return json(
        { success: false, error: 'Too many attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return json({ success: false, error: 'Password is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      twoFactorDisableLockout.recordFailure(userId);
      return json({ success: false, error: 'Invalid password' }, { status: 400 });
    }

    twoFactorDisableLockout.reset(userId);

    await prisma.twoFactorAuth.deleteMany({
      where: { user_id: userId }
    });

    logger.info(`2FA disabled for user ${userId}`);

    return json({ success: true });
  } catch (error: unknown) {
    logger.error('2FA disable error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
