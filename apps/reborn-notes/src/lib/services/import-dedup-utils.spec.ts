import { describe, it, expect } from 'vitest';
import {
  folderKey,
  rememberTitle,
  findExisting,
  computeRenamedTitle,
  isImportUnchanged,
  mergeTagIds,
  tagSetsEqual,
  ROOT_FOLDER_KEY,
  MAX_TITLE_LENGTH,
  type TitleLookup
} from './import-dedup-utils';

describe('folderKey', () => {
  it('returns the sentinel key for undefined / null', () => {
    expect(folderKey(undefined)).toBe(ROOT_FOLDER_KEY);
    expect(folderKey(null)).toBe(ROOT_FOLDER_KEY);
  });

  it('returns the folder id as-is for defined folders', () => {
    expect(folderKey('abc-123')).toBe('abc-123');
  });
});

describe('rememberTitle / findExisting', () => {
  it('stores and retrieves by case-insensitive title within a folder', () => {
    const lookup: TitleLookup = new Map();
    rememberTitle(lookup, 'folder-1', 'My Note', 'note-1');
    expect(findExisting(lookup, 'folder-1', 'my note')).toBe('note-1');
    expect(findExisting(lookup, 'folder-1', 'MY NOTE')).toBe('note-1');
  });

  it('isolates titles per folder', () => {
    const lookup: TitleLookup = new Map();
    rememberTitle(lookup, 'folder-1', 'Notes', 'note-1');
    rememberTitle(lookup, 'folder-2', 'Notes', 'note-2');
    expect(findExisting(lookup, 'folder-1', 'notes')).toBe('note-1');
    expect(findExisting(lookup, 'folder-2', 'notes')).toBe('note-2');
  });

  it('treats undefined folder as the root level', () => {
    const lookup: TitleLookup = new Map();
    rememberTitle(lookup, undefined, 'Inbox', 'note-root');
    expect(findExisting(lookup, undefined, 'inbox')).toBe('note-root');
    expect(findExisting(lookup, 'some-folder', 'inbox')).toBeUndefined();
  });

  it('returns undefined when the title is not present', () => {
    const lookup: TitleLookup = new Map();
    expect(findExisting(lookup, 'folder-1', 'missing')).toBeUndefined();
  });

  it('overwrites a previous entry when the same key is remembered twice', () => {
    const lookup: TitleLookup = new Map();
    rememberTitle(lookup, 'folder-1', 'Notes', 'note-1');
    rememberTitle(lookup, 'folder-1', 'Notes', 'note-2');
    expect(findExisting(lookup, 'folder-1', 'notes')).toBe('note-2');
  });
});

describe('computeRenamedTitle', () => {
  it('returns "Title (2)" when only the base is taken', () => {
    const taken = new Set(['notes']);
    expect(computeRenamedTitle('Notes', taken)).toBe('Notes (2)');
  });

  it('skips already-used numeric suffixes', () => {
    const taken = new Set(['notes', 'notes (2)', 'notes (3)']);
    expect(computeRenamedTitle('Notes', taken)).toBe('Notes (4)');
  });

  it('matches case-insensitively against the taken set', () => {
    const taken = new Set(['notes', 'notes (2)']);
    // Caller is expected to lowercase the set entries; verify the helper
    // honors that contract by also lowercasing candidates internally.
    expect(computeRenamedTitle('NOTES', taken)).toBe('NOTES (3)');
  });

  it('falls back to "Untitled (N)" for empty / whitespace base when the fallback is taken', () => {
    // Helper is only invoked on a confirmed collision, so the fallback name
    // is itself considered taken — verify we still produce a stable result.
    const taken = new Set(['untitled']);
    expect(computeRenamedTitle('', taken)).toBe('Untitled (2)');
    expect(computeRenamedTitle('   ', taken)).toBe('Untitled (2)');
  });

  it('preserves accented / non-ASCII characters in the base title', () => {
    const taken = new Set(['zażółć gęślą jaźń']);
    expect(computeRenamedTitle('Zażółć Gęślą Jaźń', taken)).toBe(
      'Zażółć Gęślą Jaźń (2)'
    );
  });

  it('keeps the suffix within the 100-char filename cap by trimming the base', () => {
    const longBase = 'a'.repeat(MAX_TITLE_LENGTH); // 100 chars
    const taken = new Set([longBase.toLowerCase()]);
    const result = computeRenamedTitle(longBase, taken);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result).toMatch(/\(2\)$/);
  });

  it('strips trailing whitespace from the truncated base before appending', () => {
    // Construct a base where the trim point lands on a space so the truncated
    // form would otherwise look like "...word  (2)". The helper must trim.
    const base = 'a'.repeat(MAX_TITLE_LENGTH - 8) + ' tail'; // length 97
    const taken = new Set([base.toLowerCase()]);
    const result = computeRenamedTitle(base, taken);
    expect(result).not.toMatch(/ {2}\(/);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it('returns the first free slot, even when only the base is taken (not a sequence)', () => {
    const taken = new Set(['notes', 'notes (5)']);
    expect(computeRenamedTitle('Notes', taken)).toBe('Notes (2)');
  });
});

describe('isImportUnchanged', () => {
  const existing = { title: 'Notes', content: '# Hello', tagIds: ['t1', 't2'] };

  it('returns true when title, content and tag set match', () => {
    expect(
      isImportUnchanged(existing, { title: 'Notes', content: '# Hello', tagIds: ['t2', 't1'] })
    ).toBe(true);
  });

  it('is case-SENSITIVE on title (a title-case change is a real update)', () => {
    expect(
      isImportUnchanged(existing, { title: 'notes', content: '# Hello', tagIds: ['t1', 't2'] })
    ).toBe(false);
  });

  it('returns false on any content difference', () => {
    expect(
      isImportUnchanged(existing, { title: 'Notes', content: '# Hello!', tagIds: ['t1', 't2'] })
    ).toBe(false);
  });

  it('ignores tags entirely when incoming tagIds is undefined (flat .md import)', () => {
    expect(isImportUnchanged(existing, { title: 'Notes', content: '# Hello' })).toBe(true);
  });

  it('compares tag sets order-insensitively but exactly', () => {
    expect(
      isImportUnchanged(existing, { title: 'Notes', content: '# Hello', tagIds: ['t1'] })
    ).toBe(false);
    expect(
      isImportUnchanged(existing, {
        title: 'Notes',
        content: '# Hello',
        tagIds: ['t1', 't3']
      })
    ).toBe(false);
  });

  it('treats an empty incoming tag list as different from existing tags', () => {
    expect(
      isImportUnchanged(existing, { title: 'Notes', content: '# Hello', tagIds: [] })
    ).toBe(false);
  });

  it('uses set semantics: repeated incoming tag ids do not fake a length match', () => {
    expect(
      isImportUnchanged(existing, {
        title: 'Notes',
        content: '# Hello',
        tagIds: ['t1', 't1']
      })
    ).toBe(false);
  });

  describe('merge tag mode', () => {
    it('treats incoming tags that are a subset of existing as unchanged (merge adds nothing)', () => {
      expect(
        isImportUnchanged(existing, { title: 'Notes', content: '# Hello', tagIds: ['t1'] }, 'merge')
      ).toBe(true);
    });

    it('treats an empty incoming tag list as unchanged (in-app tags survive)', () => {
      expect(
        isImportUnchanged(existing, { title: 'Notes', content: '# Hello', tagIds: [] }, 'merge')
      ).toBe(true);
    });

    it('returns false when the file carries a tag the note does not have yet', () => {
      expect(
        isImportUnchanged(
          existing,
          { title: 'Notes', content: '# Hello', tagIds: ['t1', 't3'] },
          'merge'
        )
      ).toBe(false);
    });

    it('still reports content changes as changed regardless of tags', () => {
      expect(
        isImportUnchanged(existing, { title: 'Notes', content: '# Hello!', tagIds: [] }, 'merge')
      ).toBe(false);
    });

    it('still ignores tags when incoming tagIds is undefined', () => {
      expect(isImportUnchanged(existing, { title: 'Notes', content: '# Hello' }, 'merge')).toBe(
        true
      );
    });
  });
});

describe('mergeTagIds', () => {
  it('unions existing and incoming, existing order first', () => {
    expect(mergeTagIds(['a', 'b'], ['c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('returns existing as-is when incoming adds nothing', () => {
    expect(mergeTagIds(['a', 'b'], ['b'])).toEqual(['a', 'b']);
    expect(mergeTagIds(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('handles empty existing (plain import case)', () => {
    expect(mergeTagIds([], ['x', 'y'])).toEqual(['x', 'y']);
  });

  it('collapses duplicates on both sides', () => {
    expect(mergeTagIds(['a', 'a'], ['b', 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('tagSetsEqual', () => {
  it('is order-insensitive', () => {
    expect(tagSetsEqual(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('detects added and removed elements', () => {
    expect(tagSetsEqual(['a'], ['a', 'b'])).toBe(false);
    expect(tagSetsEqual(['a', 'b'], ['a'])).toBe(false);
  });

  it('collapses duplicates before comparing', () => {
    expect(tagSetsEqual(['a', 'a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('treats two empty lists as equal', () => {
    expect(tagSetsEqual([], [])).toBe(true);
  });
});
