import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────
//
// Logout must end the session of the device that logs out and nothing else
// (it used to delete every refresh token of the user, so a logout on the macOS
// app expired the session on the phone). `handleLogout` runs for real against a
// stubbed `@reborn/database`; only `verifyToken` is stubbed, so no JWT secret is
// needed. We assert on what reached `refreshToken.deleteMany`.

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

interface LogoutInit {
  bearer?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

async function callLogout(init: LogoutInit) {
  const { POST } = await import('./+server');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init.headers
  };
  if (init.bearer) headers['Authorization'] = `Bearer ${init.bearer}`;
  const cookieJar = init.cookies ?? {};
  const event = {
    request: new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers,
      body: init.body
    }),
    cookies: {
      get: vi.fn((name: string) => cookieJar[name]),
      set: vi.fn(),
      delete: vi.fn()
    }
  };
  const response = await (POST as unknown as (event: unknown) => Promise<Response>)(event);
  return { response, status: response.status, event };
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

describe('POST /api/auth/logout - ends only this device (reborn-notes)', () => {
  it('web: revokes the family and session named by the httpOnly cookies', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'user-1',
      family_id: 'family-web',
      session_id: 'session-web'
    });

    const { status, event } = await callLogout({
      bearer: 'access',
      cookies: { refresh_token: 'web-refresh-token', session_id: 'session-web' }
    });

    expect(status).toBe(200);
    expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'web-refresh-token' } })
    );
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

  it('native: revokes the family of the body refresh token and the header session', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'user-1',
      family_id: 'family-native',
      session_id: 'session-native'
    });

    const { status } = await callLogout({
      bearer: 'access',
      headers: { 'x-reborn-session-id': 'session-native' },
      body: JSON.stringify({ refresh_token: 'native-refresh-token' })
    });

    expect(status).toBe(200);
    expect(mockPrisma.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'native-refresh-token' } })
    );
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        OR: [{ family_id: 'family-native' }, { session_id: { in: ['session-native'] } }]
      }
    });
  });

  it('never revokes all of the user when nothing names the device', async () => {
    const { status } = await callLogout({ bearer: 'access' });

    expect(status).toBe(200);
    expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('native with an expired access token: the body refresh token names the user', async () => {
    verifyToken.mockResolvedValue(null);
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      user_id: 'user-1',
      family_id: 'family-native',
      session_id: null
    });

    const { status } = await callLogout({
      bearer: 'expired-access',
      body: JSON.stringify({ refresh_token: 'native-refresh-token' })
    });

    expect(status).toBe(200);
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { user_id: 'user-1', OR: [{ family_id: 'family-native' }] }
    });
  });

  it('a session-id header alone never names the user (it is not a secret)', async () => {
    verifyToken.mockResolvedValue(null);

    const { status } = await callLogout({
      bearer: 'expired-access',
      headers: { 'x-reborn-session-id': 'session-of-someone' }
    });

    expect(status).toBe(200);
    expect(mockPrisma.userSession.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it('a malformed body does not fail the logout', async () => {
    const { status } = await callLogout({ bearer: 'access', body: 'not-json' });

    expect(status).toBe(200);
    expect(mockPrisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });
});
