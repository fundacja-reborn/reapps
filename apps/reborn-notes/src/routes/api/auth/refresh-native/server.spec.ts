import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────
//
// Same approach as ../refresh/server.spec.ts: `handleRefreshToken` runs for
// real, we stub `@reborn/database` so `refreshToken.findUnique` is a `vi.fn()`.
// findUnique -> null makes the handler short-circuit to a failure (401), so no
// JWT signing path needs mocking. We assert on WHAT reached findUnique to prove
// the token is read from the BODY (never a cookie).

const mockPrisma = {
	user: {} as Record<string, never>,
	refreshToken: {
		findUnique: vi.fn(),
		create: vi.fn(),
		updateMany: vi.fn(),
		deleteMany: vi.fn()
	}
};

vi.mock('@reborn/database', () => ({ prisma: mockPrisma }));

vi.mock('@reborn/utils', () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
}));

// ── Helpers ──────────────────────────────────────────────────────

function createMockEvent(init: { body?: string; cookie?: string }) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (init.cookie) headers['Cookie'] = init.cookie;
	return {
		request: new Request('http://localhost/api/auth/refresh-native', {
			method: 'POST',
			headers,
			body: init.body
		})
	};
}

async function callRefreshNative(init: { body?: string; cookie?: string }) {
	const { POST } = await import('./+server');
	const event = createMockEvent(init);
	const response = await (POST as unknown as (event: unknown) => Promise<Response>)(event);
	const data = await response.json();
	return { response, data, status: response.status };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	// findUnique -> null: handler short-circuits to a refresh failure (401).
	mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
});

// ── Tests ────────────────────────────────────────────────────────

describe('POST /api/auth/refresh-native (reborn-notes)', () => {
	it('reads the refresh token from the request BODY and looks it up', async () => {
		const value = 'native-refresh-token-abc';
		const { status } = await callRefreshNative({ body: JSON.stringify({ refresh_token: value }) });

		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledTimes(1);
		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { token: value } })
		);
		expect(status).toBe(401); // findUnique -> null -> 401, expected
	});

	it('returns 401 and does not hit the DB when the body has no token', async () => {
		const { status, data } = await callRefreshNative({ body: JSON.stringify({}) });

		expect(status).toBe(401);
		expect(data.success).toBe(false);
		expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
	});

	it('returns 400 on an invalid (non-JSON) body', async () => {
		const { status, data } = await callRefreshNative({ body: 'not-json' });

		expect(status).toBe(400);
		expect(data.success).toBe(false);
		expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
	});

	it('ignores a refresh_token COOKIE - body-only contract (web XSS cannot abuse it)', async () => {
		// A cookie token must NOT be honored here: the endpoint only reads the body.
		const { status } = await callRefreshNative({
			body: JSON.stringify({}),
			cookie: 'refresh_token=cookie-token-should-be-ignored'
		});

		expect(status).toBe(401);
		expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
	});
});
