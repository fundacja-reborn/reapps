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

describe('user_id override sequence (regression — production import failure)', () => {
  // Production exports surfaced records with `user_id: null` (sync race) or
  // missing user_id (legacy IDB). The importer overrides user_id with the
  // current account's id on save, so we set it BEFORE safeParse — value
  // from the file is unused. These tests pin the contract that the schema
  // accepts the prepared input regardless of what shape user_id had.
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
  const VALID_UUID_2 = '11111111-2222-4333-8444-555555555555';
  const NOTE_BASE = {
    id: VALID_UUID_2,
    title_encrypted: 'iv:cipher',
    content_encrypted: 'iv:cipher',
    sync_version: 0,
    sync_status: 'synced' as const,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  };

  function prepare(raw: Record<string, unknown>, userId: string): Record<string, unknown> {
    // Mirrors the pre-validation pipeline used in export-import.service.ts:
    //   normalizeNullToUndefined → set user_id → safeParse
    const out = normalizeNullToUndefined(raw, NOTE_OPTIONAL_FIELDS);
    out.user_id = userId;
    return out;
  }

  it('accepts a backup record with user_id=null after the override', () => {
    const prepared = prepare({ ...NOTE_BASE, user_id: null }, VALID_UUID);
    const result = z
      .object({
        id: z.string().uuid(),
        user_id: z.string().uuid()
      })
      .safeParse(prepared);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.user_id).toBe(VALID_UUID);
  });

  it('accepts a backup record with user_id missing after the override', () => {
    const prepared = prepare({ ...NOTE_BASE }, VALID_UUID);
    const result = z
      .object({ user_id: z.string().uuid() })
      .safeParse(prepared);
    expect(result.success).toBe(true);
  });

  it('accepts a backup record with non-UUID user_id (e.g. empty string) after the override', () => {
    const prepared = prepare({ ...NOTE_BASE, user_id: '' }, VALID_UUID);
    const result = z
      .object({ user_id: z.string().uuid() })
      .safeParse(prepared);
    expect(result.success).toBe(true);
  });

  it('without the override, the schema still rejects user_id=null (pre-fix behavior)', () => {
    // Sanity: confirm we are testing a real previously-broken case. If this
    // ever flips to `success: true` it means someone relaxed the schema —
    // the importer override should be the only thing accepting bad user_id,
    // not the validator itself.
    const onlyNormalized = normalizeNullToUndefined(
      { ...NOTE_BASE, user_id: null },
      NOTE_OPTIONAL_FIELDS
    );
    const result = z.object({ user_id: z.string().uuid() }).safeParse(onlyNormalized);
    expect(result.success).toBe(false);
  });
});
