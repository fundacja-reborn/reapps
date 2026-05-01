import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  normalizeNullToUndefined,
  formatZodIssues,
  FOLDER_OPTIONAL_FIELDS,
  NOTE_OPTIONAL_FIELDS,
  TAG_OPTIONAL_FIELDS
} from './import-normalize-utils';

describe('normalizeNullToUndefined', () => {
  it('replaces null with undefined for listed fields', () => {
    const out = normalizeNullToUndefined(
      { a: null, b: 'keep', c: null, d: 0 },
      ['a', 'c']
    );
    expect(out.a).toBeUndefined();
    expect(out.b).toBe('keep');
    expect(out.c).toBeUndefined();
    expect(out.d).toBe(0);
  });

  it('does not touch fields that are not in the list', () => {
    const out = normalizeNullToUndefined({ a: null, b: null }, ['a']);
    expect(out.a).toBeUndefined();
    expect(out.b).toBeNull();
  });

  it('leaves undefined as undefined', () => {
    const out = normalizeNullToUndefined({ a: undefined }, ['a']);
    expect(out.a).toBeUndefined();
  });

  it('leaves valid string values intact', () => {
    const out = normalizeNullToUndefined(
      { folder_id: 'abc-123' },
      ['folder_id']
    );
    expect(out.folder_id).toBe('abc-123');
  });

  it('does not mutate the input object', () => {
    const input = { folder_id: null, title: 'x' };
    const out = normalizeNullToUndefined(input, ['folder_id']);
    expect(input.folder_id).toBeNull();
    expect(out.folder_id).toBeUndefined();
  });

  it('produces output where JSON.stringify drops the cleared field', () => {
    // The end-to-end value: a normalized record re-emitted via JSON should
    // not carry the null forward. This is the property that ensures
    // round-trip exports stay clean.
    const out = normalizeNullToUndefined(
      { folder_id: null, title: 't' },
      ['folder_id']
    );
    expect(JSON.parse(JSON.stringify(out))).toEqual({ title: 't' });
  });
});

describe('formatZodIssues', () => {
  it('includes the field path and message for a single issue', () => {
    const schema = z.object({ folder_id: z.string().uuid() });
    const result = schema.safeParse({ folder_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodIssues(result.error);
      expect(formatted).toContain('folder_id');
      // Don't assert on Zod's exact wording — just that it surfaces *something*
      // beyond the bare "Invalid input" the default extractor would return.
      expect(formatted.length).toBeGreaterThan('folder_id'.length + 2);
    }
  });

  it('joins multiple issues with "; "', () => {
    const schema = z.object({
      a: z.string(),
      b: z.number()
    });
    const result = schema.safeParse({ a: 1, b: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodIssues(result.error);
      expect(formatted).toContain('; ');
      expect(formatted).toContain('a');
      expect(formatted).toContain('b');
    }
  });

  it('handles top-level errors (empty path)', () => {
    const schema = z.string();
    const result = schema.safeParse(123);
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodIssues(result.error);
      // Should produce a message (no leading "."), not "Invalid input" alone.
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted).not.toMatch(/^\./);
    }
  });
});

describe('field lists stay in sync with schema expectations', () => {
  it('lists every field that legacy IDB might hold as null', () => {
    expect(FOLDER_OPTIONAL_FIELDS).toContain('parent_id');
    expect(NOTE_OPTIONAL_FIELDS).toContain('folder_id');
    expect(NOTE_OPTIONAL_FIELDS).toContain('metadata_encrypted');
    expect(TAG_OPTIONAL_FIELDS).toContain('color_encrypted');
  });
});
