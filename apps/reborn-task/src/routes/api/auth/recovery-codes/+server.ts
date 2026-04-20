import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@reborn/utils';
import { verifyToken } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('RecoveryCodes');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars, no ambiguous I/O/0/1
const CODE_COUNT = 8;
const CODE_LENGTH = 10; // 5+5 formatted as XXXXX-XXXXX

function generateCode(): string {
	const bytes = randomBytes(CODE_LENGTH);
	let code = '';
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
	}
	return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function hashCode(code: string): string {
	// Normalize: remove dash, uppercase
	const normalized = code.replace(/-/g, '').toUpperCase();
	return createHash('sha256').update(normalized).digest('hex');
}

function getUserId(authHeader: string | null): Promise<string | null> {
	const token = authHeader?.replace('Bearer ', '');
	if (!token) return Promise.resolve(null);
	return verifyToken(token)
		.then((data) => data?.userId ?? null)
		.catch(() => null);
}

/**
 * GET /api/auth/recovery-codes
 * Returns status: whether codes exist, how many unused remain
 */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		const codes = await prisma.recoveryCode.findMany({
			where: { user_id: userId },
			select: { id: true, is_used: true, created_at: true }
		});

		const total = codes.length;
		const usedCount = codes.filter((c: { is_used: boolean }) => c.is_used).length;
		const availableCount = total - usedCount;

		return json({
			success: true,
			data: {
				hasCodesGenerated: total > 0,
				totalCount: total,
				usedCount,
				availableCount,
				generatedAt: total > 0 ? codes[0].created_at : null
			}
		});
	} catch (error: unknown) {
		logger.error('Get recovery codes status error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};

/**
 * POST /api/auth/recovery-codes
 * Generates 8 new codes (deletes old ones), returns plaintexts ONCE
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		// Delete existing codes
		await prisma.recoveryCode.deleteMany({ where: { user_id: userId } });

		// Generate new codes
		const plaintextCodes: string[] = [];
		const codeRecords = [];

		for (let i = 0; i < CODE_COUNT; i++) {
			const code = generateCode();
			plaintextCodes.push(code);
			codeRecords.push({
				user_id: userId,
				code_hash: hashCode(code),
				is_used: false
			});
		}

		await prisma.recoveryCode.createMany({ data: codeRecords });

		logger.info(`Generated ${CODE_COUNT} recovery codes for user ${userId}`);

		// Return plaintexts — only shown once
		return json({
			success: true,
			data: { codes: plaintextCodes, count: CODE_COUNT }
		});
	} catch (error: unknown) {
		logger.error('Generate recovery codes error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};

/**
 * DELETE /api/auth/recovery-codes
 * Removes all recovery codes (used before regenerating)
 */
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserId(request.headers.get('authorization'));
		if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

		await prisma.recoveryCode.deleteMany({ where: { user_id: userId } });

		return json({ success: true });
	} catch (error: unknown) {
		logger.error('Delete recovery codes error:', error);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
