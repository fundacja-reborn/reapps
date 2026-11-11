import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────

const mockPrisma = {
  note: { findFirst: vi.fn() },
  noteVersion: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
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

vi.mock('$lib/server/storage-quota', () => ({
  checkQuota: vi.fn().mockResolvedValue({ allowed: true, used: 0, limit: 1000 })
}));

// ── Helpers ──────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const NOTE_ID = '7a1b2c3d-0000-4000-8000-000000000001';
const VERSION_ID = '7a1b2c3d-0000-4000-8000-0000000000aa';

async function callDeleteAll(query = '') {
  const { DELETE } = await import('./+server');
  const url = new URL(`http://localhost/api/notes/${NOTE_ID}/versions${query}`);
  const event = {
    request: new Request(url, { method: 'DELETE', headers: { authorization: 'Bearer t' } }),
    params: { id: NOTE_ID },
    url
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (DELETE as any)(event);
  return { status: response.status, body: await response.json() };
}

async function callDeleteOne(versionId: string) {
  const { DELETE } = await import('./[versionId]/+server');
  const url = new URL(`http://localhost/api/notes/${NOTE_ID}/versions/${versionId}`);
  const event = {
    request: new Request(url, { method: 'DELETE', headers: { authorization: 'Bearer t' } }),
    params: { id: NOTE_ID, versionId },
    url
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (DELETE as any)(event);
  return { status: response.status, body: await response.json() };
}

async function callDeleteAllForUser() {
  const { DELETE } = await import('../../../user/versions/+server');
  const url = new URL('http://localhost/api/user/versions');
  const event = {
    request: new Request(url, { method: 'DELETE', headers: { authorization: 'Bearer t' } }),
    params: {},
    url
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (DELETE as any)(event);
  return { status: response.status, body: await response.json() };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserFromToken.mockResolvedValue(USER_ID);
  mockPrisma.noteVersion.deleteMany.mockResolvedValue({ count: 3 });
});

// ── Tests ────────────────────────────────────────────────────────

describe('DELETE /api/notes/[id]/versions (#521)', () => {
  it('401 without a valid token, nothing deleted', async () => {
    mockGetUserFromToken.mockResolvedValue(null);
    const { status } = await callDeleteAll();
    expect(status).toBe(401);
    expect(mockPrisma.noteVersion.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the whole history of the note, scoped to the user', async () => {
    const { status, body } = await callDeleteAll();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, deleted: 3 });
    expect(mockPrisma.noteVersion.deleteMany).toHaveBeenCalledWith({
      where: { note_id: NOTE_ID, user_id: USER_ID }
    });
  });

  it('?keep spares that one version', async () => {
    await callDeleteAll(`?keep=${VERSION_ID}`);
    expect(mockPrisma.noteVersion.deleteMany).toHaveBeenCalledWith({
      where: { note_id: NOTE_ID, user_id: USER_ID, id: { not: VERSION_ID } }
    });
  });

  it('400 for a keep value that is not a UUID, nothing deleted', async () => {
    const { status } = await callDeleteAll('?keep=not-a-uuid');
    expect(status).toBe(400);
    expect(mockPrisma.noteVersion.deleteMany).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-empty history still succeeds', async () => {
    mockPrisma.noteVersion.deleteMany.mockResolvedValue({ count: 0 });
    const { status, body } = await callDeleteAll();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, deleted: 0 });
  });
});

describe('DELETE /api/notes/[id]/versions/[versionId] (#521)', () => {
  it('401 without a valid token, nothing deleted', async () => {
    mockGetUserFromToken.mockResolvedValue(null);
    const { status } = await callDeleteOne(VERSION_ID);
    expect(status).toBe(401);
    expect(mockPrisma.noteVersion.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes one version, scoped to the note AND the user', async () => {
    mockPrisma.noteVersion.deleteMany.mockResolvedValue({ count: 1 });
    const { status, body } = await callDeleteOne(VERSION_ID);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, deleted: 1 });
    expect(mockPrisma.noteVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: VERSION_ID, note_id: NOTE_ID, user_id: USER_ID }
    });
  });

  it('400 for a version id that is not a UUID', async () => {
    const { status } = await callDeleteOne('nope');
    expect(status).toBe(400);
    expect(mockPrisma.noteVersion.deleteMany).not.toHaveBeenCalled();
  });

  it('is idempotent: an unknown version succeeds with deleted 0', async () => {
    mockPrisma.noteVersion.deleteMany.mockResolvedValue({ count: 0 });
    const { status, body } = await callDeleteOne(VERSION_ID);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, deleted: 0 });
  });
});

describe('DELETE /api/user/versions (#521)', () => {
  it('401 without a valid token, nothing deleted', async () => {
    mockGetUserFromToken.mockResolvedValue(null);
    const { status } = await callDeleteAllForUser();
    expect(status).toBe(401);
    expect(mockPrisma.noteVersion.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes every version of the user's notes and nobody else's", async () => {
    const { status, body } = await callDeleteAllForUser();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, deleted: 3 });
    expect(mockPrisma.noteVersion.deleteMany).toHaveBeenCalledWith({
      where: { user_id: USER_ID }
    });
  });
});
