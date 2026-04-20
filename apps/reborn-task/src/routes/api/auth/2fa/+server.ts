import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { verifyPassword } from '@reborn/crypto';
import { prisma } from '@reborn/database';
import * as OTPAuth from 'otpauth';
import { twoFactorDisableLockout } from '$lib/server/rate-limit';

const logger = createLogger('2FA-API');
const ISSUER = 'Reborn Apps';

/**
 * GET /api/auth/2fa — Check 2FA status
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '');

		if (!token) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const tokenData = await verifyToken(token);
		if (!tokenData?.userId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const twoFactor = await prisma.twoFactorAuth.findUnique({
			where: { user_id: tokenData.userId }
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
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '');

		if (!token) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const tokenData = await verifyToken(token);
		if (!tokenData?.userId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		// Check if 2FA is already enabled
		const existing = await prisma.twoFactorAuth.findUnique({
			where: { user_id: tokenData.userId }
		});

		if (existing?.is_enabled) {
			return json({ success: false, error: '2FA is already enabled' }, { status: 400 });
		}

		// Get username for TOTP label
		const user = await prisma.user.findUnique({
			where: { id: tokenData.userId },
			select: { username: true }
		});

		if (!user) {
			return json({ success: false, error: 'User not found' }, { status: 404 });
		}

		// Generate TOTP secret
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

		// Save secret (not yet enabled) — upsert in case of re-setup
		await prisma.twoFactorAuth.upsert({
			where: { user_id: tokenData.userId },
			update: {
				secret_server: secretBase32,
				secret_encrypted: '', // Will be set by client after verification
				is_enabled: false
			},
			create: {
				user_id: tokenData.userId,
				secret_server: secretBase32,
				secret_encrypted: '',
				is_enabled: false
			}
		});

		logger.info(`2FA setup initiated for user ${tokenData.userId}`);

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
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '');

		if (!token) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const tokenData = await verifyToken(token);
		if (!tokenData?.userId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json();
		const { code, secretEncrypted } = body;

		if (!code || typeof code !== 'string' || code.length !== 6) {
			return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
		}

		// Get pending 2FA record
		const twoFactor = await prisma.twoFactorAuth.findUnique({
			where: { user_id: tokenData.userId }
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

		// Verify TOTP code
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

		// Enable 2FA
		await prisma.twoFactorAuth.update({
			where: { user_id: tokenData.userId },
			data: {
				is_enabled: true,
				secret_encrypted: secretEncrypted || ''
			}
		});

		logger.info(`2FA enabled for user ${tokenData.userId}`);

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
		const authHeader = request.headers.get('authorization');
		const token = authHeader?.replace('Bearer ', '');

		if (!token) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const tokenData = await verifyToken(token);
		if (!tokenData?.userId) {
			return json({ success: false, error: 'Unauthorized' }, { status: 401 });
		}

		const retryAfter = twoFactorDisableLockout.retryAfter(tokenData.userId);
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

		// Verify password
		const user = await prisma.user.findUnique({
			where: { id: tokenData.userId }
		});

		if (!user) {
			return json({ success: false, error: 'User not found' }, { status: 404 });
		}

		const isValid = await verifyPassword(password, user.password_hash);
		if (!isValid) {
			twoFactorDisableLockout.recordFailure(tokenData.userId);
			return json({ success: false, error: 'Invalid password' }, { status: 400 });
		}

		twoFactorDisableLockout.reset(tokenData.userId);

		// Delete 2FA record
		await prisma.twoFactorAuth.deleteMany({
			where: { user_id: tokenData.userId }
		});

		logger.info(`2FA disabled for user ${tokenData.userId}`);

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('2FA disable error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
