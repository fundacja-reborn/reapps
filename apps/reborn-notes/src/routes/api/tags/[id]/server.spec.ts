import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────

const mockPrisma = {
  tag: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    update: vi.fn()
  }
};

vi.mock('@reborn/database', () => ({ prisma: mockPrisma }));

const mockGetUserFromToken = vi.fn();
vi.mock('$lib/server/auth', () => ({
  getUserFromToken: (...args: unknown[]) => mockGetUserFromToken(...args)
}));

vi.mock('@reborn/utils', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
}));

vi.mock('@reborn/types', () => ({
  validateBody: vi.fn(),
  schemas: { UpdateTagRequestSchema: {} }
}));

// ── Helpers ──────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const TAG_ID = 'b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e';

function createDeleteEvent(tagId: string) {
  return {
    request: new Request(`http://localhost/api/tags/${tagId}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer mock-token' }
    }),
    params: { id: tagId }
  };
}

async function callDelete(tagId: string) {
  const { DELETE } = await import('./+server');
  const event = createDeleteEvent(tagId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (DELETE as any)(event);
  const data = await response.json();
  return { status: response.status, data };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserFromToken.mockResolvedValue(USER_ID);
});

// ── Tests ────────────────────────────────────────────────────────

describe('DELETE /api/tags/[id] (idempotency)', () => {
  // (a) Existing tag → 200 + actual delete
  it('deletes an existing tag owned by the caller', async () => {
    mockPrisma.tag.findFirst.mockResolvedValue({ id: TAG_ID, user_id: USER_ID });
    mockPrisma.tag.delete.mockResolvedValue({});

    const { status, data } = await callDelete(TAG_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.tag.findFirst).toHaveBeenCalledWith({
      where: { id: TAG_ID, user_id: USER_ID }
    });
    expect(mockPrisma.tag.delete).toHaveBeenCalledWith({ where: { id: TAG_ID } });
  });

  // (b) Tag absent server-side → 200, no delete attempted (idempotent no-op).
  // Same regression class as folder DELETE: avoids burning the fire-and-forget
  // retry budget on tags that were never synced.
  it('returns 200 (no-op) when the tag does not exist', async () => {
    mockPrisma.tag.findFirst.mockResolvedValue(null);

    const { status, data } = await callDelete(TAG_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.tag.delete).not.toHaveBeenCalled();
  });

  // (c) Tag owned by another user → 200, but no delete (no existence leak)
  it('returns 200 (no-op) for a tag owned by another user, without deleting it', async () => {
    mockPrisma.tag.findFirst.mockResolvedValue(null);

    const { status, data } = await callDelete(TAG_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.tag.findFirst).toHaveBeenCalledWith({
      where: { id: TAG_ID, user_id: USER_ID }
    });
    expect(mockPrisma.tag.delete).not.toHaveBeenCalled();
  });

  // (d) No auth → 401 (unchanged behavior)
  it('returns 401 when the caller is unauthenticated', async () => {
    mockGetUserFromToken.mockResolvedValue(null);

    const { status, data } = await callDelete(TAG_ID);

    expect(status).toBe(401);
    expect(data.success).toBe(false);
    expect(mockPrisma.tag.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.tag.delete).not.toHaveBeenCalled();
  });
});
