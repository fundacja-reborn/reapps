import { describe, it, expect } from 'vitest';
import {
  parseMarkdownFile,
  extractFolderSegments,
  containsHiddenSegment,
  countImportableMarkdownFiles,
  getRootFolderName,
  normalizeFrontmatterDate,
  pickImportTimestamps
} from './markdown-import-utils';

describe('parseMarkdownFile', () => {
  it('returns raw content and null metadata when no frontmatter is present', () => {
    const raw = '# Hello\n\nBody text.';
    const result = parseMarkdownFile(raw);
    expect(result.title).toBeNull();
    expect(result.content).toBe(raw);
    expect(result.tags).toEqual([]);
    expect(result.created).toBeNull();
    expect(result.modified).toBeNull();
  });

  it('extracts title from frontmatter and strips the frontmatter block from content', () => {
    const raw = '---\ntitle: "My Note"\n---\nBody text.';
    const result = parseMarkdownFile(raw);
    expect(result.title).toBe('My Note');
    expect(result.content).toBe('Body text.');
  });

  it('unescapes quotes and backslashes in the title', () => {
    const raw = '---\ntitle: "He said \\"hi\\" \\\\ bye"\n---\n';
    const result = parseMarkdownFile(raw);
    expect(result.title).toBe('He said "hi" \\ bye');
  });

  it('parses inline tag arrays with mixed quoting', () => {
    const raw = '---\ntags: [foo, "bar baz", \'qux\']\n---\nBody';
    const result = parseMarkdownFile(raw);
    expect(result.tags).toEqual(['foo', 'bar baz', 'qux']);
  });

  it('parses YAML list form of tags', () => {
    const raw = '---\ntags:\n  - foo\n  - "bar baz"\n  - qux\n---\nBody';
    const result = parseMarkdownFile(raw);
    expect(result.tags).toEqual(['foo', 'bar baz', 'qux']);
  });

  it('returns empty tag array when no tags field is present', () => {
    const raw = '---\ntitle: Solo\n---\n';
    const result = parseMarkdownFile(raw);
    expect(result.tags).toEqual([]);
  });

  it('extracts created and modified dates from canonical field names', () => {
    const raw =
      '---\ncreated: 2023-05-01T10:00:00Z\nmodified: 2024-06-15T12:30:00Z\n---\nBody';
    const result = parseMarkdownFile(raw);
    expect(result.created).toBe('2023-05-01T10:00:00Z');
    expect(result.modified).toBe('2024-06-15T12:30:00Z');
  });

  it('accepts `date` as a created alias and `updated` as a modified alias', () => {
    const raw = '---\ndate: 2023-01-02\nupdated: 2023-01-03\n---\n';
    const result = parseMarkdownFile(raw);
    expect(result.created).toBe('2023-01-02');
    expect(result.modified).toBe('2023-01-03');
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Windows\r\ntags: [a, b]\r\n---\r\nBody\r\n';
    const result = parseMarkdownFile(raw);
    expect(result.title).toBe('Windows');
    expect(result.tags).toEqual(['a', 'b']);
    expect(result.content).toBe('Body\r\n');
  });

  it('ignores unknown frontmatter properties but still strips the block from content', () => {
    const raw =
      '---\ntitle: Known\naliases: [x, y]\ncssclass: custom\n---\n# Body\n';
    const result = parseMarkdownFile(raw);
    expect(result.title).toBe('Known');
    expect(result.content).toBe('# Body\n');
    expect(result.tags).toEqual([]);
  });
});

describe('extractFolderSegments', () => {
  it('returns [] for an empty path', () => {
    expect(extractFolderSegments('')).toEqual([]);
  });

  it('returns [] for a file directly in the chosen root (2 segments)', () => {
    expect(extractFolderSegments('MyVault/note.md')).toEqual([]);
  });

  it('strips root and filename, keeping intermediate folders', () => {
    expect(extractFolderSegments('MyVault/Projects/Web/note.md')).toEqual([
      'Projects',
      'Web'
    ]);
  });

  it('tolerates deep hierarchies', () => {
    expect(extractFolderSegments('Root/a/b/c/d/note.md')).toEqual([
      'a',
      'b',
      'c',
      'd'
    ]);
  });

  it('ignores double slashes and leading slash artifacts', () => {
    expect(extractFolderSegments('/Root//a/note.md')).toEqual(['a']);
  });

  describe('keepRoot', () => {
    it('preserves the root directory as the first segment', () => {
      expect(extractFolderSegments('MyVault/Projects/Web/note.md', true)).toEqual([
        'MyVault',
        'Projects',
        'Web'
      ]);
    });

    it('maps a file directly in the chosen root to [root]', () => {
      expect(extractFolderSegments('MyVault/note.md', true)).toEqual(['MyVault']);
    });

    it('returns [] for an empty path', () => {
      expect(extractFolderSegments('', true)).toEqual([]);
    });

    it('returns [] for a bare filename without any directory', () => {
      expect(extractFolderSegments('note.md', true)).toEqual([]);
    });
  });
});

describe('getRootFolderName', () => {
  it('reads the first segment of the first file with a relative path', () => {
    expect(
      getRootFolderName([
        { name: 'a.md', webkitRelativePath: 'reapps-docs/guidelines/a.md' },
        { name: 'b.md', webkitRelativePath: 'reapps-docs/b.md' }
      ])
    ).toBe('reapps-docs');
  });

  it('skips files without a relative path', () => {
    expect(
      getRootFolderName([
        { name: 'pasted.md' },
        { name: 'a.md', webkitRelativePath: 'Vault/a.md' }
      ])
    ).toBe('Vault');
  });

  it('tolerates leading slash artifacts', () => {
    expect(getRootFolderName([{ name: 'a.md', webkitRelativePath: '/Vault/a.md' }])).toBe(
      'Vault'
    );
  });

  it('returns null when no file carries a relative path', () => {
    expect(getRootFolderName([{ name: 'a.md' }, { name: 'b.md', webkitRelativePath: '' }])).toBe(
      null
    );
  });

  it('returns null for an empty list', () => {
    expect(getRootFolderName([])).toBe(null);
  });
});

describe('countImportableMarkdownFiles', () => {
  it('counts only .md files outside hidden directories', () => {
    expect(
      countImportableMarkdownFiles([
        { name: 'a.md', webkitRelativePath: 'Vault/a.md' },
        { name: 'B.MD', webkitRelativePath: 'Vault/sub/B.MD' },
        { name: 'plugin.json', webkitRelativePath: 'Vault/.obsidian/plugin.json' },
        { name: 'trashed.md', webkitRelativePath: 'Vault/.trash/trashed.md' },
        { name: 'image.png', webkitRelativePath: 'Vault/image.png' }
      ])
    ).toBe(2);
  });

  it('does not treat a hidden ROOT directory as hidden (user picked it)', () => {
    expect(
      countImportableMarkdownFiles([{ name: 'a.md', webkitRelativePath: '.vault/a.md' }])
    ).toBe(1);
  });

  it('counts flat files without a relative path by extension only', () => {
    expect(countImportableMarkdownFiles([{ name: 'a.md' }, { name: 'b.txt' }])).toBe(1);
  });
});

describe('containsHiddenSegment', () => {
  it('returns false when no path segment starts with a dot', () => {
    expect(containsHiddenSegment('MyVault/Projects/Web/note.md')).toBe(false);
  });

  it('returns true when a subfolder starts with a dot (e.g. .obsidian)', () => {
    expect(containsHiddenSegment('MyVault/.obsidian/config.json')).toBe(true);
  });

  it('returns true when a nested subfolder starts with a dot', () => {
    expect(containsHiddenSegment('MyVault/Projects/.hidden/note.md')).toBe(true);
  });

  it('returns true when .trash is anywhere in the path', () => {
    expect(containsHiddenSegment('MyVault/.trash/deleted.md')).toBe(true);
  });

  it('does NOT flag a hidden root — the user deliberately chose it', () => {
    expect(containsHiddenSegment('.myvault/Projects/note.md')).toBe(false);
  });

  it('flags dotfile filenames in subfolders', () => {
    // `.gitignore` at the root of a subfolder — still hidden-by-convention
    expect(containsHiddenSegment('MyVault/code/.gitignore')).toBe(true);
  });

  it('returns false for an empty path', () => {
    expect(containsHiddenSegment('')).toBe(false);
  });
});

describe('normalizeFrontmatterDate', () => {
  it('returns null for null input', () => {
    expect(normalizeFrontmatterDate(null)).toBeNull();
  });

  it('returns null for empty/whitespace input', () => {
    expect(normalizeFrontmatterDate('')).toBeNull();
    expect(normalizeFrontmatterDate('   ')).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    expect(normalizeFrontmatterDate('not a date')).toBeNull();
  });

  it('normalizes ISO 8601 to canonical form', () => {
    expect(normalizeFrontmatterDate('2024-01-15T10:30:00Z')).toBe(
      '2024-01-15T10:30:00.000Z'
    );
  });

  it('normalizes date-only strings to ISO midnight UTC', () => {
    expect(normalizeFrontmatterDate('2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
  });
});

describe('pickImportTimestamps', () => {
  const noFrontmatter = { created: null, modified: null };
  const fmCreated = '2024-01-10T08:00:00Z';
  const fmModified = '2024-02-20T14:30:00Z';

  it('uses frontmatter created/modified when present', () => {
    const mtime = new Date('2025-06-01T00:00:00Z').getTime();
    const result = pickImportTimestamps(
      { created: fmCreated, modified: fmModified },
      mtime
    );
    expect(result.createdAt).toBe('2024-01-10T08:00:00.000Z');
    expect(result.modifiedAt).toBe('2024-02-20T14:30:00.000Z');
  });

  it('falls back to file.lastModified for both fields when frontmatter is absent', () => {
    const mtime = new Date('2025-06-01T12:34:56Z').getTime();
    const result = pickImportTimestamps(noFrontmatter, mtime);
    expect(result.createdAt).toBe('2025-06-01T12:34:56.000Z');
    expect(result.modifiedAt).toBe('2025-06-01T12:34:56.000Z');
  });

  it('falls back to lastModified per-field independently', () => {
    const mtime = new Date('2025-06-01T00:00:00Z').getTime();
    // Only `created` in frontmatter, no `modified`
    const result = pickImportTimestamps({ created: fmCreated, modified: null }, mtime);
    expect(result.createdAt).toBe('2024-01-10T08:00:00.000Z');
    expect(result.modifiedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('returns undefined for both when frontmatter is absent and lastModified is 0', () => {
    const result = pickImportTimestamps(noFrontmatter, 0);
    expect(result.createdAt).toBeUndefined();
    expect(result.modifiedAt).toBeUndefined();
  });

  it('treats unparseable frontmatter dates as missing and falls back to mtime', () => {
    const mtime = new Date('2025-06-01T00:00:00Z').getTime();
    const result = pickImportTimestamps(
      { created: 'not a date', modified: '' },
      mtime
    );
    expect(result.createdAt).toBe('2025-06-01T00:00:00.000Z');
    expect(result.modifiedAt).toBe('2025-06-01T00:00:00.000Z');
  });
});
