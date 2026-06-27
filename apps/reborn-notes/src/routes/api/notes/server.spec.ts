import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────

const mockPrisma = {
  note: {
    findMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn()
  },
  folder: {
    findFirst: vi.fn()
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
  schemas: { CreateNoteRequestSchema: {} }
}));

vi.mock('$lib/server/storage-quota', () => ({
  checkQuota: vi.fn().mockResolvedValue({ allowed: true, used: 0, limit: 1000 })
}));

// ── Helpers ──────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

function noteRow(id: string, updatedAt: string) {
  return {
    id,
    folder_id: null,
    title_encrypted: 'iv:title',
    content_encrypted: 'iv:content',
    excerpt_encrypted: null,
    metadata_encrypted: null,
    is_archived: false,
    deleted_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date(updatedAt),
    sync_version: 1
  };
}

async function callGet(query: string) {
  const { GET } = await import('./+server');
  const url = new URL(`http://localhost/api/notes${query}`);
  const event = {
    request: new Request(url, { headers: { authorization: 'Bearer mock-token' } }),
    url
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (GET as any)(event);
  const data = await response.json();
  return { status: response.status, body: data };
}

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserFromToken.mockResolvedValue(USER_ID);
});

// ── Tests ────────────────────────────────────────────────────────

describe('GET /api/notes - legacy (un-paginated) mode', () => {
  it('returns the full set with no `page` envelope when no limit/cursor is sent', async () => {
    mockPrisma.note.findMany.mockResolvedValue([
      noteRow('a', '2026-02-01T00:00:00.000Z'),
      noteRow('b', '2026-01-15T00:00:00.000Z')
    ]);

    const { status, body } = await callGet('?include_archived=true');

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    // No pagination envelope - old clients read `data` and ignore the rest.
    expect(body.page).toBeUndefined();
    // Old behavior: newest-first, single findMany, no count for total.
    const args = mockPrisma.note.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ updated_at: 'desc' });
    expect(mockPrisma.note.count).not.toHaveBeenCalled();
  });

  it('still honors `since` (gt) in legacy mode', async () => {
    mockPrisma.note.findMany.mockResolvedValue([]);
    await callGet('?include_archived=true&since=2026-02-01T00:00:00.000Z');
    const args = mockPrisma.note.findMany.mock.calls[0][0];
    expect(args.where.updated_at).toEqual({ gt: new Date('2026-02-01T00:00:00.000Z') });
  });
});

describe('GET /api/notes - paginated delta mode', () => {
  it('first page: keyset order, has_more via peek, next_cursor, total, no all_ids without reconcile', async () => {
    // limit=2 with a peek of 3 rows -> has_more, page trimmed to 2.
    mockPrisma.note.findMany.mockResolvedValue([
      noteRow('a', '2026-01-01T00:00:00.000Z'),
      noteRow('b', '2026-01-02T00:00:00.000Z'),
      noteRow('c', '2026-01-03T00:00:00.000Z')
    ]);
    mockPrisma.note.count.mockResolvedValue(42);

    const { status, body } = await callGet('?include_archived=true&limit=2');

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.page.has_more).toBe(true);
    expect(typeof body.page.next_cursor).toBe('string');
    expect(body.page.total).toBe(42);
    expect(body.page.all_ids).toBeUndefined();

    // Ascending keyset order + peek (take = limit + 1).
    const pageArgs = mockPrisma.note.findMany.mock.calls[0][0];
    expect(pageArgs.orderBy).toEqual([{ updated_at: 'asc' }, { id: 'asc' }]);
    expect(pageArgs.take).toBe(3);
  });

  it('first page with reconcile=true returns all_ids (full id set, independent of the delta)', async () => {
    mockPrisma.note.findMany.mockImplementation((args: { select?: { id: boolean } }) => {
      if (args.select?.id) {
        return Promise.resolve([{ id: 'a' }, { id: 'b' }, { id: 'x' }, { id: 'y' }]);
      }
      return Promise.resolve([noteRow('a', '2026-01-01T00:00:00.000Z')]);
    });
    mockPrisma.note.count.mockResolvedValue(1);

    const { body } = await callGet('?include_archived=true&limit=200&reconcile=true');

    expect(body.page.all_ids).toEqual(['a', 'b', 'x', 'y']);
    expect(body.page.has_more).toBe(false);
    // all_ids query carries no since/cursor filter - the whole user's id set.
    const idsCall = mockPrisma.note.findMany.mock.calls.find((c) => c[0]?.select?.id);
    expect(idsCall?.[0].where).toEqual({ user_id: USER_ID });
  });

  it('first page applies `since` INCLUSIVELY (gte) so a boundary row is never missed', async () => {
    mockPrisma.note.findMany.mockResolvedValue([]);
    mockPrisma.note.count.mockResolvedValue(0);
    await callGet('?include_archived=true&limit=200&since=2026-02-01T00:00:00.000Z');
    const pageArgs = mockPrisma.note.findMany.mock.calls[0][0];
    expect(pageArgs.where.updated_at).toEqual({ gte: new Date('2026-02-01T00:00:00.000Z') });
  });

  it('cursor page uses a keyset OR predicate and omits total/all_ids', async () => {
    mockPrisma.note.findMany.mockResolvedValue([noteRow('c', '2026-01-03T00:00:00.000Z')]);
    // Build a valid cursor for (updated_at, id).
    const cursor = Buffer.from(
      JSON.stringify({ u: '2026-01-02T00:00:00.000Z', i: 'b' })
    ).toString('base64url');

    const { body } = await callGet(
      `?include_archived=true&limit=200&reconcile=true&cursor=${cursor}`
    );

    expect(body.page.total).toBeUndefined();
    expect(body.page.all_ids).toBeUndefined();
    expect(mockPrisma.note.count).not.toHaveBeenCalled();
    const pageArgs = mockPrisma.note.findMany.mock.calls[0][0];
    expect(pageArgs.where.OR).toEqual([
      { updated_at: { gt: new Date('2026-01-02T00:00:00.000Z') } },
      { updated_at: new Date('2026-01-02T00:00:00.000Z'), id: { gt: 'b' } }
    ]);
  });

  it('rejects a malformed cursor with 400', async () => {
    const { status, body } = await callGet('?include_archived=true&cursor=not-a-valid-cursor!!');
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('clamps limit to the max page size', async () => {
    mockPrisma.note.findMany.mockResolvedValue([]);
    mockPrisma.note.count.mockResolvedValue(0);
    await callGet('?include_archived=true&limit=99999');
    const pageArgs = mockPrisma.note.findMany.mock.calls[0][0];
    expect(pageArgs.take).toBe(501); // MAX_PAGE_LIMIT (500) + 1 peek
  });
});

describe('GET /api/notes - auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetUserFromToken.mockResolvedValue(null);
    const { status } = await callGet('?limit=200');
    expect(status).toBe(401);
  });
});
