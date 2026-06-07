import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// ── Mocks ────────────────────────────────────────────────────────

const mockPrisma = {
	user: { findUnique: vi.fn(), update: vi.fn() },
	recoveryCode: { findFirst: vi.fn(), update: vi.fn() },
	refreshToken: { create: vi.fn(), updateMany: vi.fn() },
	userSession: { create: vi.fn() }
};

vi.mock('@reborn/database', () => ({ prisma: mockPrisma }));

const mockLockout = {
	isLocked: vi.fn().mockReturnValue(false),
	recordFailure: vi.fn(),
	reset: vi.fn(),
	retryAfter: vi.fn().mockReturnValue(0)
};

vi.mock('$lib/server/rate-limit', () => ({ twoFactorLockout: mockLockout }));

vi.mock('@reborn/auth/server', () => ({
	generateTokens: vi.fn().mockResolvedValue({
		accessToken: 'mock-access',
		refreshToken: 'mock-refresh'
	}),
	REFRESH_TOKEN_TTL_SECONDS: 60 * 60 * 24 * 30,
	refreshTokenExpiryDate: () => new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
}));

vi.mock('@reborn/utils', () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
}));

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

// Mock OTPAuth for TOTP branch
vi.mock('otpauth', () => {
	class MockTOTP {
		validate({ token }: { token: string }) {
			return token === '123456' ? 0 : null;
		}
	}
	return {
		TOTP: MockTOTP,
		Secret: { fromBase32: (s: string) => s }
	};
});

// ── Helpers ──────────────────────────────────────────────────────

const MOCK_USER_ID = '550e8400-e29b-41d4-a716-446655440000';

const mockUser = {
	id: MOCK_USER_ID,
	username: 'testuser',
	master_key_encrypted: 'enc-mk',
	master_key_salt: 'mk-salt',
	created_at: new Date('2025-01-01'),
	updated_at: new Date('2025-01-01'),
	twoFactorAuth: {
		is_enabled: true,
		secret_server: 'JBSWY3DPEHPK3PXP'
	}
};

/** SHA256 of normalized code (strip dashes, uppercase) — same as production hashCode */
function expectedHash(code: string): string {
	const normalized = code.replace(/-/g, '').toUpperCase();
	return createHash('sha256').update(normalized).digest('hex');
}

function createMockEvent(body: unknown) {
	const cookieStore = new Map<string, string>();
	return {
		request: new Request('http://localhost/api/auth/2fa/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		cookies: {
			set: vi.fn((name: string, value: string) => cookieStore.set(name, value)),
			get: vi.fn((name: string) => cookieStore.get(name)),
			delete: vi.fn()
		}
	};
}

async function callEndpoint(body: unknown) {
	const { POST } = await import('./+server');
	const event = createMockEvent(body);
	const response = await (POST as Function)(event);
	const data = await response.json();
	return { response, data, status: response.status };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();

	mockPrisma.user.findUnique.mockResolvedValue(mockUser);
	mockPrisma.user.update.mockResolvedValue(mockUser);
	mockPrisma.refreshToken.create.mockResolvedValue({});
	mockPrisma.refreshToken.updateMany.mockResolvedValue({});
	mockPrisma.userSession.create.mockResolvedValue({ id: 'session-1' });

	mockLockout.isLocked.mockReturnValue(false);
	mockLockout.retryAfter.mockReturnValue(0);
});

// ── Tests ────────────────────────────────────────────────────────

describe('POST /api/auth/2fa/verify (reborn-notes)', () => {
	// (a) Recovery code ABCDE-FGHIJ → 200, correct SHA256 hash
	it('should accept valid recovery code with dash (ABCDE-FGHIJ)', async () => {
		const code = 'ABCDE-FGHIJ';
		const hash = expectedHash(code);

		mockPrisma.recoveryCode.findFirst.mockResolvedValue({
			id: 'rc-1',
			code_hash: hash,
			is_used: false
		});
		mockPrisma.recoveryCode.update.mockResolvedValue({});

		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code });

		expect(status).toBe(200);
		expect(data.success).toBe(true);

		expect(mockPrisma.recoveryCode.findFirst).toHaveBeenCalledWith({
			where: {
				user_id: MOCK_USER_ID,
				code_hash: hash,
				is_used: false
			}
		});

		expect(mockPrisma.recoveryCode.update).toHaveBeenCalledWith({
			where: { id: 'rc-1' },
			data: { is_used: true, used_at: expect.any(Date) }
		});

		expect(mockLockout.reset).toHaveBeenCalledWith(MOCK_USER_ID);
	});

	// (b) Lowercase abcde-fghij → 200, same hash (case-insensitivity)
	it('should accept lowercase recovery code (case-insensitive normalization)', async () => {
		const uppercaseHash = expectedHash('ABCDE-FGHIJ');
		const lowercaseHash = expectedHash('abcde-fghij');

		// Core N4 fix: both produce the same hash
		expect(lowercaseHash).toBe(uppercaseHash);

		mockPrisma.recoveryCode.findFirst.mockResolvedValue({
			id: 'rc-2',
			code_hash: lowercaseHash,
			is_used: false
		});
		mockPrisma.recoveryCode.update.mockResolvedValue({});

		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code: 'abcde-fghij' });

		expect(status).toBe(200);
		expect(data.success).toBe(true);
		expect(mockPrisma.recoveryCode.findFirst).toHaveBeenCalledWith({
			where: {
				user_id: MOCK_USER_ID,
				code_hash: uppercaseHash,
				is_used: false
			}
		});
	});

	// (c) Without dash ABCDEFGHIJ (10 chars > 6) → 200, treated as recovery code
	it('should accept recovery code without dash (10 chars detected as recovery)', async () => {
		const code = 'ABCDEFGHIJ';
		const hash = expectedHash(code);

		mockPrisma.recoveryCode.findFirst.mockResolvedValue({
			id: 'rc-3',
			code_hash: hash,
			is_used: false
		});
		mockPrisma.recoveryCode.update.mockResolvedValue({});

		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code });

		expect(status).toBe(200);
		expect(data.success).toBe(true);
	});

	// (d) Invalid recovery code (not in DB) → 400, recordFailure called
	it('should reject invalid recovery code not found in DB', async () => {
		mockPrisma.recoveryCode.findFirst.mockResolvedValue(null);

		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code: 'XXXXX-YYYYY' });

		expect(status).toBe(400);
		expect(data.success).toBe(false);
		expect(mockLockout.recordFailure).toHaveBeenCalledWith(MOCK_USER_ID);
	});

	// (e) Already used code → 400
	it('should reject already-used recovery code', async () => {
		mockPrisma.recoveryCode.findFirst.mockResolvedValue(null);

		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code: 'USED1-CODE2' });

		expect(status).toBe(400);
		expect(data.success).toBe(false);
	});

	// (f) Empty code → 400
	it('should reject empty code', async () => {
		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code: '' });

		expect(status).toBe(400);
		expect(data.error).toBe('Invalid verification code');
	});

	// (g) Code > 20 characters → 400
	it('should reject code exceeding 20 characters', async () => {
		const { status, data } = await callEndpoint({
			userId: MOCK_USER_ID,
			code: 'A'.repeat(21)
		});

		expect(status).toBe(400);
		expect(data.error).toBe('Invalid verification code');
	});

	// (h) Missing userId → 400
	it('should reject request without userId', async () => {
		const { status, data } = await callEndpoint({ code: '123456' });

		expect(status).toBe(400);
		expect(data.error).toBe('Missing userId');
	});

	// (i) Locked user (rate limit) → 429
	it('should return 429 when user is locked out', async () => {
		mockLockout.isLocked.mockReturnValue(true);
		mockLockout.retryAfter.mockReturnValue(600);

		const { status, data, response } = await callEndpoint({
			userId: MOCK_USER_ID,
			code: '123456'
		});

		expect(status).toBe(429);
		expect(data.success).toBe(false);
		expect(response.headers.get('Retry-After')).toBe('600');
	});

	// (j) TOTP 6-digit code → 200 (sanity, no regression)
	it('should accept valid 6-digit TOTP code', async () => {
		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code: '123456' });

		expect(status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.data.access_token).toBe('mock-access');
		// refresh_token is sent as httpOnly cookie, not in JSON body
		expect(mockLockout.reset).toHaveBeenCalledWith(MOCK_USER_ID);
	});

	// (k) userId > 36 characters → 400 (notes-specific validation)
	it('should reject userId exceeding 36 characters', async () => {
		const { status, data } = await callEndpoint({
			userId: 'x'.repeat(37),
			code: '123456'
		});

		expect(status).toBe(400);
		expect(data.error).toBe('Missing userId');
	});

	// (l) TOTP code != 6 digits → 400 (notes has explicit length check in TOTP branch)
	it('should reject TOTP code that is not exactly 6 digits', async () => {
		// 5-digit code (not a recovery code: no dash, length <= 6... wait, length is 5 which is ≤ 6)
		// Notes checks trimmedCode.length !== 6 in the TOTP branch
		const { status, data } = await callEndpoint({ userId: MOCK_USER_ID, code: '12345' });

		expect(status).toBe(400);
		expect(data.error).toBe('Invalid verification code');
	});
});
