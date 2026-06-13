import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────

const mockPrisma = {
  folder: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
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
  schemas: { UpdateFolderRequestSchema: {} }
}));

// ── Helpers ──────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const FOLDER_ID = '4591259b-5201-4c5a-b174-6d73a71049b8';

function createDeleteEvent(folderId: string) {
  return {
    request: new Request(`http://localhost/api/folders/${folderId}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer mock-token' }
    }),
    params: { id: folderId }
  };
}

async function callDelete(folderId: string) {
  const { DELETE } = await import('./+server');
  const event = createDeleteEvent(folderId);
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

describe('DELETE /api/folders/[id] (idempotency)', () => {
  // (a) Existing folder → 200 + actual delete
  it('deletes an existing folder owned by the caller', async () => {
    mockPrisma.folder.findFirst.mockResolvedValue({ id: FOLDER_ID, user_id: USER_ID });
    mockPrisma.folder.deleteMany.mockResolvedValue({ count: 1 });

    const { status, data } = await callDelete(FOLDER_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.folder.findFirst).toHaveBeenCalledWith({
      where: { id: FOLDER_ID, user_id: USER_ID }
    });
    // deleteMany (idempotent), scoped by user_id so ownership is enforced.
    expect(mockPrisma.folder.deleteMany).toHaveBeenCalledWith({
      where: { id: FOLDER_ID, user_id: USER_ID }
    });
    expect(mockPrisma.folder.delete).not.toHaveBeenCalled();
  });

  // (b) Folder absent server-side → 200, no delete attempted (idempotent no-op)
  // This is the regression case: client-side `pushFolderDelete` would otherwise
  // burn its 4-attempt retry window on a folder that was never synced or was
  // already removed.
  it('returns 200 (no-op) when the folder does not exist', async () => {
    mockPrisma.folder.findFirst.mockResolvedValue(null);

    const { status, data } = await callDelete(FOLDER_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.folder.deleteMany).not.toHaveBeenCalled();
  });

  // (c) Folder owned by a different user → 200, but no delete (no existence leak)
  it('returns 200 (no-op) for a folder owned by another user, without deleting it', async () => {
    // findFirst is scoped by user_id, so foreign rows look identical to absent rows.
    mockPrisma.folder.findFirst.mockResolvedValue(null);

    const { status, data } = await callDelete(FOLDER_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.folder.findFirst).toHaveBeenCalledWith({
      where: { id: FOLDER_ID, user_id: USER_ID }
    });
    expect(mockPrisma.folder.deleteMany).not.toHaveBeenCalled();
  });

  // (d) Concurrent parent-cascade already removed the row → 200, NOT a 500.
  // Deleting a folder fires parallel DELETEs for the parent and each descendant;
  // the parent's onDelete:Cascade can win and remove a descendant before its own
  // explicit DELETE runs. `delete` would throw P2025 -> 500; `deleteMany` matches
  // 0 rows and is a clean no-op. (Surfaced during folder-sync smoke testing.)
  it('returns 200 when a parent-cascade already removed the row mid-handler', async () => {
    mockPrisma.folder.findFirst.mockResolvedValue({ id: FOLDER_ID, user_id: USER_ID });
    mockPrisma.folder.deleteMany.mockResolvedValue({ count: 0 });

    const { status, data } = await callDelete(FOLDER_ID);

    expect(status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(mockPrisma.folder.deleteMany).toHaveBeenCalledWith({
      where: { id: FOLDER_ID, user_id: USER_ID }
    });
  });

  // (e) No auth → 401 (unchanged behavior)
  it('returns 401 when the caller is unauthenticated', async () => {
    mockGetUserFromToken.mockResolvedValue(null);

    const { status, data } = await callDelete(FOLDER_ID);

    expect(status).toBe(401);
    expect(data.success).toBe(false);
    expect(mockPrisma.folder.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.folder.deleteMany).not.toHaveBeenCalled();
  });
});
