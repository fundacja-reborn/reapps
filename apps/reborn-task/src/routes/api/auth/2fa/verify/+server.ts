import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { generateTokens, REFRESH_TOKEN_TTL_SECONDS, refreshTokenExpiryDate } from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { v4 as uuidv4 } from 'uuid';
import * as OTPAuth from 'otpauth';
import { twoFactorLockout } from '$lib/server/rate-limit';

const logger = createLogger('2FA-Verify');
const ISSUER = 'Reborn Apps';

/**
 * POST /api/auth/2fa/verify — Verify TOTP code during login
 * Called after password authentication when 2FA is required
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const body = await request.json();
		const { userId, code } = body;

		if (!userId || typeof userId !== 'string') {
			return json({ success: false, error: 'Missing userId' }, { status: 400 });
		}

		if (!code || typeof code !== 'string' || code.trim().length === 0 || code.trim().length > 20) {
			return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
		}

		// Per-userId lockout check
		if (twoFactorLockout.isLocked(userId)) {
			const retryAfter = twoFactorLockout.retryAfter(userId);
			return json(
				{ success: false, error: 'Account temporarily locked. Too many failed attempts.' },
				{ status: 429, headers: { 'Retry-After': String(retryAfter) } }
			);
		}

		// Get user and 2FA record
		const user = await prisma.user.findUnique({
			where: { id: userId },
			include: { twoFactorAuth: true }
		});

		if (!user || !user.twoFactorAuth?.is_enabled) {
			return json({ success: false, error: 'Invalid verification request' }, { status: 400 });
		}

		// Check if code is a recovery code
		const trimmedCode = code.trim();
		const isRecoveryCode = trimmedCode.includes('-') || trimmedCode.length > 6;
		if (isRecoveryCode) {
			// Try recovery code — normalize same as generation: strip dashes, uppercase
			const crypto = await import('crypto');
			const normalized = trimmedCode.replace(/-/g, '').toUpperCase();
			const codeHash = crypto.createHash('sha256').update(normalized).digest('hex');

			const recoveryCode = await prisma.recoveryCode.findFirst({
				where: {
					user_id: userId,
					code_hash: codeHash,
					is_used: false
				}
			});

			if (!recoveryCode) {
				twoFactorLockout.recordFailure(userId);
				return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
			}

			// Mark recovery code as used
			await prisma.recoveryCode.update({
				where: { id: recoveryCode.id },
				data: { is_used: true, used_at: new Date() }
			});

			logger.info(`Recovery code used for 2FA verification, user ${userId}`);
		} else {
			// Verify TOTP code
			const totp = new OTPAuth.TOTP({
				issuer: ISSUER,
				algorithm: 'SHA1',
				digits: 6,
				period: 30,
				secret: OTPAuth.Secret.fromBase32(user.twoFactorAuth.secret_server)
			});

			const delta = totp.validate({ token: trimmedCode, window: 1 });

			if (delta === null) {
				twoFactorLockout.recordFailure(userId);
				return json({ success: false, error: 'Invalid verification code' }, { status: 400 });
			}
		}

		// 2FA verified, clear lockout
		twoFactorLockout.reset(userId);

		// Generate tokens
		const { accessToken, refreshToken } = await generateTokens(user.id);

		// Save refresh token
		const expiresAt = refreshTokenExpiryDate();

		await prisma.refreshToken.create({
			data: {
				token: refreshToken,
				user_id: user.id,
				family_id: uuidv4(),
				expires_at: expiresAt
			}
		});

		// Set HTTP-only cookie for refresh token
		cookies.set('refresh_token', refreshToken, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: REFRESH_TOKEN_TTL_SECONDS,
			path: '/'
		});

		// Create UserSession
		try {
			const session = await prisma.userSession.create({
				data: {
					user_id: user.id,
					expires_at: expiresAt,
					device_info_encrypted: null,
					is_active: true
				}
			});

			// Link the refresh token to this session
			await prisma.refreshToken.updateMany({
				where: { token: refreshToken },
				data: { session_id: session.id }
			});

			// Set session_id cookie so logout can deactivate this specific session
			cookies.set('session_id', session.id, {
				httpOnly: true,
				secure: process.env.NODE_ENV === 'production',
				sameSite: 'lax',
				maxAge: REFRESH_TOKEN_TTL_SECONDS,
				path: '/'
			});
		} catch {
			// Non-critical
		}

		// Update last login
		await prisma.user.update({
			where: { id: user.id },
			data: { last_login_at: new Date() }
		});

		logger.info(`2FA verification successful for user ${user.username}`);

		return json({
			success: true,
			data: {
				user: {
					id: user.id,
					username: user.username,
					created_at: user.created_at.toISOString(),
					updated_at: user.updated_at.toISOString()
				},
				encryptedMasterKey: user.master_key_encrypted,
				masterKeySalt: user.master_key_salt,
				access_token: accessToken
			}
		});
	} catch (error: unknown) {
		logger.error('2FA verify error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
