import { describe, expect, it, vi } from 'vitest';
import { handleRefreshToken } from './handlers';

/**
 * Regression coverage for the "false 'Session expired' banner after local
 * server rebuild" bug (see docs/development/planning/session-expiry-server-rebuild-resilience.md).
 *
 * Auth-level failures (validation, missing/revoked/expired token) must resolve
 * with `{ success: false }` so the route maps them to 401 (definitive expiry).
 * Infrastructure failures (Prisma cold-start, DB unreachable, JWT signing
 * exception) must **propagate** so the route maps them to 500 - client then
 * classifies as transient and stays in offline mode instead of flashing the
 * session-expired banner.
 */

function makeStoredToken(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    id: 'token-row-1',
    token: 'valid-refresh-token',
    user_id: 'user-1',
    family_id: 'family-1',
    is_revoked: false,
    expires_at: future,
    session_id: null,
    user: {
      id: 'user-1',
      username: 'alice',
      master_key_encrypted: 'mk-enc',
      master_key_salt: 'mk-salt',
      created_at: now,
      updated_at: now
    },
    ...overrides
  };
}

function makeDbClient(overrides: Partial<{
  findUnique: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
  updateMany: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
}> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    refreshToken: {
      findUnique: overrides.findUnique ?? vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: overrides.create ?? vi.fn().mockResolvedValue({}),
      delete: vi.fn(),
      deleteMany: overrides.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 1 })
    }
  } as never;
}

describe('handleRefreshToken - auth vs infrastructure failure classification', () => {
  it('returns { success: false } when the token is not in the database (definitive 401)', async () => {
    const dbClient = makeDbClient({
      findUnique: vi.fn().mockResolvedValue(null)
    });

    const result = await handleRefreshToken(
      { refresh_token: 'unknown-token' },
      { dbClient }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid or expired refresh token');
  });

  it('revokes the family and returns { success: false } on token reuse (definitive 401)', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const dbClient = makeDbClient({
      findUnique: vi.fn().mockResolvedValue(makeStoredToken({ is_revoked: true })),
      deleteMany
    });

    const result = await handleRefreshToken(
      { refresh_token: 'valid-refresh-token' },
      { dbClient }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Token reuse detected. Please log in again.');
    expect(deleteMany).toHaveBeenCalledWith({
      where: { family_id: 'family-1' }
    });
  });

  it('returns { success: false } when the token has expired (definitive 401)', async () => {
    const past = new Date(Date.now() - 60_000);
    const dbClient = makeDbClient({
      findUnique: vi.fn().mockResolvedValue(makeStoredToken({ expires_at: past }))
    });

    const result = await handleRefreshToken(
      { refresh_token: 'valid-refresh-token' },
      { dbClient }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid or expired refresh token');
  });

  it('propagates Prisma errors instead of swallowing them (route should map to 5xx)', async () => {
    // Simulates Prisma cold-start / connection error after a docker rebuild.
    // Before the fix, the handler's inner try/catch returned `{ success: false }`,
    // the route mapped to 401, and the client flashed the session-expired banner.
    const dbError = new Error('Can\'t reach database server');
    dbError.name = 'PrismaClientInitializationError';
    const dbClient = makeDbClient({
      findUnique: vi.fn().mockRejectedValue(dbError)
    });

    await expect(
      handleRefreshToken({ refresh_token: 'valid-refresh-token' }, { dbClient })
    ).rejects.toThrow('Can\'t reach database server');
  });

  it('propagates JWT signing errors instead of swallowing them', async () => {
    const dbClient = makeDbClient({
      findUnique: vi.fn().mockResolvedValue(makeStoredToken())
    });
    const generateTokens = vi.fn().mockRejectedValue(new Error('JWT_SECRET missing'));

    await expect(
      handleRefreshToken(
        { refresh_token: 'valid-refresh-token' },
        { dbClient, generateTokens }
      )
    ).rejects.toThrow('JWT_SECRET missing');
  });

  it('happy path: rotates the token within the same family', async () => {
    const findUnique = vi.fn().mockResolvedValue(makeStoredToken());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({});
    const dbClient = makeDbClient({ findUnique, updateMany, create });
    const generateTokens = vi.fn().mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh'
    });

    const result = await handleRefreshToken(
      { refresh_token: 'valid-refresh-token' },
      { dbClient, generateTokens }
    );

    expect(result.success).toBe(true);
    expect(result.data?.accessToken).toBe('new-access');
    expect(result.data?.refreshToken).toBe('new-refresh');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'token-row-1' },
      data: { is_revoked: true }
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        token: 'new-refresh',
        family_id: 'family-1',
        user_id: 'user-1'
      })
    });
  });
});
