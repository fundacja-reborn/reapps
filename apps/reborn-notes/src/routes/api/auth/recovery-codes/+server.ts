import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@reborn/utils';
import { prisma } from '@reborn/database';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('Notes-RecoveryCodes');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_COUNT = 8;
const CODE_LENGTH = 10;

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function hashCode(code: string): string {
  const normalized = code.replace(/-/g, '').toUpperCase();
  return createHash('sha256').update(normalized).digest('hex');
}

/** GET /api/auth/recovery-codes — status (count, used, generated-at) */
export const GET: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const codes = await prisma.recoveryCode.findMany({
      where: { user_id: userId },
      select: { id: true, is_used: true, created_at: true }
    });

    const total = codes.length;
    const usedCount = codes.filter((c) => c.is_used).length;

    return json({
      success: true,
      data: {
        hasCodesGenerated: total > 0,
        totalCount: total,
        usedCount,
        availableCount: total - usedCount,
        generatedAt: total > 0 ? codes[0].created_at : null
      }
    });
  } catch (error: unknown) {
    logger.error('Get recovery codes error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/** POST /api/auth/recovery-codes — generate 8 new codes (deletes old), returns plaintexts ONCE */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    await prisma.recoveryCode.deleteMany({ where: { user_id: userId } });

    const plaintextCodes: string[] = [];
    const codeRecords = [];

    for (let i = 0; i < CODE_COUNT; i++) {
      const code = generateCode();
      plaintextCodes.push(code);
      codeRecords.push({ user_id: userId, code_hash: hashCode(code), is_used: false });
    }

    await prisma.recoveryCode.createMany({ data: codeRecords });

    logger.info(`Generated ${CODE_COUNT} recovery codes for user ${userId}`);
    return json({ success: true, data: { codes: plaintextCodes, count: CODE_COUNT } });
  } catch (error: unknown) {
    logger.error('Generate recovery codes error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

/** DELETE /api/auth/recovery-codes — remove all */
export const DELETE: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    await prisma.recoveryCode.deleteMany({ where: { user_id: userId } });
    return json({ success: true });
  } catch (error: unknown) {
    logger.error('Delete recovery codes error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
