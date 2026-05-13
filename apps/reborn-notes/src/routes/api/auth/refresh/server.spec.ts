import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse as parseCookie } from 'cookie';

// ── Mocks ────────────────────────────────────────────────────────
//
// Round-trip cookie test (see ./+server.ts for the full contract comment).
//
// `parseCookie` above is imported from the SAME `cookie` package the SvelteKit
// runtime uses to parse the `Cookie` header. The override in
// `pnpm-workspace.yaml` (`cookie: 0.7.2`) pins one version across the whole
// graph, so what we exercise here is bitwise identical to what runtime does.
//
// `handleRefreshToken` runs for real: we stub `@reborn/database` so
// `refreshToken.findUnique` is a `vi.fn()` and assert on its `where.token`
// argument. The handler short-circuits on `findUnique` -> null, so no JWT
// signing path needs mocking.

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

/**
 * Build a SvelteKit-shaped event whose `cookies.get(name)` returns the value
 * after `cookie.parse()` - identical to what SvelteKit gives request handlers.
 */
function createMockEvent(cookieHeader: string) {
	const parsed = parseCookie(cookieHeader);
	return {
		request: new Request('http://localhost/api/auth/refresh', { method: 'POST' }),
		cookies: {
			get: vi.fn((name: string) => parsed[name]),
			set: vi.fn(),
			delete: vi.fn()
		}
	};
}

async function callRefresh(cookieHeader: string) {
	const { POST } = await import('./+server');
	const event = createMockEvent(cookieHeader);
	const response = await (POST as Function)(event);
	return { response, status: response.status };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	// findUnique returns null -> handleRefreshToken short-circuits to 401.
	// We only care about WHAT was passed to findUnique, not the outcome.
	mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
});

// ── Tests ────────────────────────────────────────────────────────

describe('POST /api/auth/refresh - cookie value round-trip (reborn-notes)', () => {
	// 1. Sanity baseline: a JWT-shaped value with safe chars passes through
	//    untouched. Locks in the no-op path so a future parser change that
	//    accidentally trims/normalizes normal tokens is caught.
	it('passes JWT-like baseline value through parser unchanged', async () => {
		const value = 'aB1.cD2-eF3_gH4';
		const { status } = await callRefresh(`refresh_token=${value}`);

		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledTimes(1);
		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { token: value } })
		);
		expect(status).toBe(401); // findUnique returned null -> 401, expected
	});

	// 2. base64url-with-padding: a real refresh token from
	//    `randomBytes(32).toString('base64')` can end with `=`. The parser
	//    must keep trailing `=` chars - they are legal in cookie value and
	//    only the FIRST `=` separates name from value.
	it('preserves trailing `=` padding in base64-style values', async () => {
		const value = 'pX9.qR2_sT5-uV8=';
		await callRefresh(`refresh_token=${value}`);

		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { token: value } })
		);
	});

	// 3. Surrounding `"` quotes - the exact regression case from cookie@1.x.
	//    v0.7.2 strips the outer quotes (RFC 6265 quoted-string handling);
	//    v1.0 delegated unquoting to `decode`, and `decodeURIComponent`
	//    leaves `"` intact - so a token stored as `abc` would be looked up
	//    as `"abc"` and miss every row. This test fails if any future bump
	//    silently changes that behavior.
	it('strips RFC 6265 surrounding double-quotes from the cookie value', async () => {
		const inner = 'quoted-value-abc';
		await callRefresh(`refresh_token="${inner}"`);

		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { token: inner } })
		);
	});

	// 4. URL-encoded value - `cookies.set()` runs `encodeURIComponent`, so
	//    on the way back the browser sends the encoded form. The parser
	//    must decode it before we hit the DB. If a future bump drops the
	//    default decoder, refresh would silently look up `token%20with...`
	//    in a DB that holds the decoded form.
	it('URL-decodes %20 to space via decodeURIComponent', async () => {
		await callRefresh('refresh_token=token%20with%20encoded');

		expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { token: 'token with encoded' } })
		);
	});
});
