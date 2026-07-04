import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────

const mockPrisma = {
  folder: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn()
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

const mockValidateBody = vi.fn();
vi.mock('@reborn/types', () => ({
  validateBody: (...args: unknown[]) => mockValidateBody(...args),
  schemas: { CreateFolderRequestSchema: {} }
}));

// ── Helpers ──────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const FOLDER_ID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
const FOLDER_BODY = { id: FOLDER_ID, name_encrypted: 'iv:ciphertext', order_index: 0 };

async function callPost() {
  const { POST } = await import('./+server');
  const event = {
    request: new Request('http://localhost/api/folders', {
      method: 'POST',
      headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json' },
      body: JSON.stringify(FOLDER_BODY)
    })
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (POST as any)(event);
  const data = await response.json();
  return { status: response.status, data };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserFromToken.mockResolvedValue(USER_ID);
  mockValidateBody.mockReturnValue({ success: true, data: FOLDER_BODY });
  mockPrisma.folder.upsert.mockResolvedValue({
    id: FOLDER_ID,
    created_at: new Date(),
    updated_at: new Date(),
    sync_version: 1
  });
});

// ── Tests ────────────────────────────────────────────────────────

describe('POST /api/folders (per-user row cap)', () => {
  it('creates a folder while under the cap', async () => {
    mockPrisma.folder.findUnique.mockResolvedValue(null);
    mockPrisma.folder.count.mockResolvedValue(499);

    const { status, data } = await callPost();

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockPrisma.folder.count).toHaveBeenCalledWith({ where: { user_id: USER_ID } });
    expect(mockPrisma.folder.upsert).toHaveBeenCalled();
  });

  it('rejects a create at the cap with 422 FOLDER_LIMIT_EXCEEDED', async () => {
    mockPrisma.folder.findUnique.mockResolvedValue(null);
    mockPrisma.folder.count.mockResolvedValue(500);

    const { status, data } = await callPost();

    expect(status).toBe(422);
    expect(data).toEqual({ success: false, error: 'FOLDER_LIMIT_EXCEEDED', limit: 500 });
    expect(mockPrisma.folder.upsert).not.toHaveBeenCalled();
  });

  // The POST is an upsert: a re-push of an existing row must never be blocked
  // by the cap, or an over-cap account could not sync edits to what it has.
  it('lets an update of an existing own row through without counting', async () => {
    mockPrisma.folder.findUnique.mockResolvedValue({ user_id: USER_ID });

    const { status, data } = await callPost();

    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockPrisma.folder.count).not.toHaveBeenCalled();
    expect(mockPrisma.folder.upsert).toHaveBeenCalled();
  });

  it('still returns 403 for a row owned by another user (cap not consulted)', async () => {
    mockPrisma.folder.findUnique.mockResolvedValue({ user_id: 'someone-else' });

    const { status, data } = await callPost();

    expect(status).toBe(403);
    expect(data.success).toBe(false);
    expect(mockPrisma.folder.count).not.toHaveBeenCalled();
    expect(mockPrisma.folder.upsert).not.toHaveBeenCalled();
  });
});
