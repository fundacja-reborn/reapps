import { describe, it, expect, vi } from 'vitest';

// ── sanitizeFilename hardening (audit 012 N5) ───────────────────────────────
// A note title / folder name becomes a path segment in ZIP entries and
// downloads. Dot-only names must not survive (a folder named ".." yields a
// "../note.md" entry - zip-slip on naive extractors), and Windows-reserved
// device names / trailing dots would make the archive fail to extract there.
//
// The heavy service layer is faked the same way the link-rewrite integration
// spec fakes its deps (no IndexedDB / crypto in vitest) - we only need the
// module to load.

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/stores/auth.store', async () => {
  const { writable } = await import('svelte/store');
  return { authStore: writable({ isAuthenticated: true, hasE2E: true }) };
});

vi.mock('@reborn/storage', () => ({
  noteStore: {},
  folderStore: {},
  tagStore: {},
  noteTagStore: {},
  noteTagOperations: {},
  noteTagQueries: {}
}));

vi.mock('./note.service', () => ({}));
vi.mock('./folder.service', () => ({}));
vi.mock('./tag.service', () => ({}));
vi.mock('./notes-sync.service', () => ({ pushNote: () => {}, pushPendingItems: () => {} }));
vi.mock('./note-index.svelte', () => ({ noteIndex: {} }));

import { sanitizeFilename } from './export-import.service';

describe('sanitizeFilename (audit 012 N5)', () => {
  it('keeps ordinary titles intact', () => {
    expect(sanitizeFilename('Meeting notes 2026')).toBe('Meeting notes 2026');
    expect(sanitizeFilename('Zażółć gęślą jaźń')).toBe('Zażółć gęślą jaźń');
  });

  it('replaces path separators and control characters (existing behavior)', () => {
    expect(sanitizeFilename('a/b\\c:d')).toBe('a_b_c_d');
    expect(sanitizeFilename('tab\there')).toBe('tab_here');
  });

  it('neutralizes dot-only names instead of emitting traversal segments', () => {
    expect(sanitizeFilename('..')).toBe('untitled');
    expect(sanitizeFilename('.')).toBe('untitled');
    expect(sanitizeFilename('...')).toBe('untitled');
  });

  it('strips trailing dots and spaces (unextractable on Windows)', () => {
    expect(sanitizeFilename('notes.')).toBe('notes');
    expect(sanitizeFilename('notes... ')).toBe('notes');
    // Leading dots are preserved - a hidden file is valid, only the tail breaks.
    expect(sanitizeFilename('.hidden')).toBe('.hidden');
  });

  it('defuses Windows reserved device names, with or without an extension', () => {
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('con')).toBe('_con');
    expect(sanitizeFilename('PRN.notes')).toBe('_PRN.notes');
    expect(sanitizeFilename('LPT1')).toBe('_LPT1');
    // Not reserved: the device name must be the whole base name.
    expect(sanitizeFilename('CONTRACT')).toBe('CONTRACT');
    expect(sanitizeFilename('conference')).toBe('conference');
  });

  it('still falls back to "untitled" for empty input and caps the length', () => {
    expect(sanitizeFilename('')).toBe('untitled');
    expect(sanitizeFilename('   ')).toBe('untitled');
    expect(sanitizeFilename('x'.repeat(300))).toHaveLength(100);
  });
});
