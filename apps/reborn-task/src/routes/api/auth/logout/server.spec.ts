import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────
//
// Logout must end the session of this browser and nothing else: the tokens are
// shared with reborn-notes, so deleting every refresh token of the user here
// expired the notes session on all of the user's other devices too.
// `handleLogout` runs for real against a stubbed `@reborn/database`; only
// `verifyToken` is stubbed, so no JWT secret is needed.

const mockPrisma = {
	user: {} as Record<string, never>,
	refreshToken: {
		findUnique: vi.fn(),
		create: vi.fn(),
		updateMany: vi.fn(),
		deleteMany: vi.fn()
	},
	userSession: {
		findUnique: vi.fn(),
		updateMany: vi.fn()
	}
};

vi.mock('@reborn/database', () => ({ prisma: mockPrisma }));

vi.mock('@reborn/utils', () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
}));

const verifyToken = vi.fn();
vi.mock('@reborn/auth/server', async (importOriginal) => ({
	...(await importOriginal<typeof import('@reborn/auth/server')>()),
	verifyToken: (...args: unknown[]) => verifyToken(...args)
}));

// ── Helpers ──────────────────────────────────────────────────────

async function callLogout(cookieJar: Record<string, string>) {
	const { POST } = await import('./+server');
	const event = {
		request: new Request('http://localhost/api/auth/logout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' }
		}),
		cookies: {
			get: vi.fn((name: string) => cookieJar[name]),
			set: vi.fn(),
			delete: vi.fn()
		}
	};
	const response = await (POST as unknown as (event: unknown) => Promise<Response>)(event);
	return { status: response.status, event };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	verifyToken.mockResolvedValue({ userId: 'user-1' });
	mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
	mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
	mockPrisma.userSession.findUnique.mockResolvedValue(null);
	mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });
});

// ── Tests ────────────────────────────────────────────────────────

describe('POST /api/auth/logout - ends only this browser (reborn-task)', () => {
	it('revokes the family and session named by the httpOnly cookies', async () => {
		mockPrisma.refreshToken.findUnique.mockResolvedValue({
			user_id: 'user-1',
			family_id: 'family-web',
			session_id: 'session-web'
		});

		const { status, event } = await callLogout({
			refresh_token: 'web-refresh-token',
			session_id: 'session-web'
		});

		expect(status).toBe(200);
		expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
		expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
			where: {
				user_id: 'user-1',
				OR: [{ family_id: 'family-web' }, { session_id: { in: ['session-web'] } }]
			}
		});
		expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ['session-web'] }, user_id: 'user-1' },
			data: { is_active: false }
		});
		expect(event.cookies.delete).toHaveBeenCalledWith('refresh_token', { path: '/' });
		expect(event.cookies.delete).toHaveBeenCalledWith('session_id', { path: '/' });
	});

	it('never revokes all of the user when no cookie names the browser', async () => {
		const { status } = await callLogout({});

		expect(status).toBe(200);
		expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
	});
});
