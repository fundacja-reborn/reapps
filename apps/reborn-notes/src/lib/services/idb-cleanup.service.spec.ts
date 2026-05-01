import { describe, it, expect } from 'vitest';
import { repairUserId } from './idb-cleanup.service';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_UUID = '11111111-2222-3333-4444-555555555555';

describe('repairUserId', () => {
  it('replaces null user_id with currentUserId', () => {
    const input: { user_id: unknown; x: number } = { user_id: null, x: 1 };
    const result = repairUserId(input, VALID_UUID);
    expect(result.changed).toBe(true);
    expect(result.cleaned.user_id).toBe(VALID_UUID);
  });

  it('replaces missing user_id with currentUserId', () => {
    const input: { user_id?: unknown; x: number } = { x: 1 };
    const result = repairUserId(input, VALID_UUID);
    expect(result.changed).toBe(true);
    expect(result.cleaned.user_id).toBe(VALID_UUID);
  });

  it('replaces empty-string user_id with currentUserId', () => {
    const result = repairUserId({ user_id: '' }, VALID_UUID);
    expect(result.changed).toBe(true);
    expect(result.cleaned.user_id).toBe(VALID_UUID);
  });

  it('replaces non-UUID string user_id with currentUserId', () => {
    const result = repairUserId({ user_id: 'not-a-uuid' }, VALID_UUID);
    expect(result.changed).toBe(true);
    expect(result.cleaned.user_id).toBe(VALID_UUID);
  });

  it('replaces non-string user_id (number) with currentUserId', () => {
    const result = repairUserId({ user_id: 123 }, VALID_UUID);
    expect(result.changed).toBe(true);
    expect(result.cleaned.user_id).toBe(VALID_UUID);
  });

  it('keeps a valid UUID user_id even when currentUserId is different', () => {
    // We don't transfer ownership of legacy local records that already
    // carry a valid UUID — that would silently rewrite multi-account IDB
    // history. Only invalid values get repaired.
    const result = repairUserId({ user_id: OTHER_UUID }, VALID_UUID);
    expect(result.changed).toBe(false);
    expect(result.cleaned.user_id).toBe(OTHER_UUID);
  });

  it('does nothing when currentUserId is null (auth not ready)', () => {
    const result = repairUserId({ user_id: null }, null);
    expect(result.changed).toBe(false);
    expect(result.cleaned.user_id).toBeNull();
  });

  it('does nothing when currentUserId itself is invalid', () => {
    // Defensive: never propagate a malformed currentUserId into local data.
    const result = repairUserId({ user_id: null }, 'not-a-uuid');
    expect(result.changed).toBe(false);
    expect(result.cleaned.user_id).toBeNull();
  });

  it('does not mutate the input record', () => {
    const input = { user_id: null, title: 'x' };
    const result = repairUserId(input, VALID_UUID);
    expect(input.user_id).toBeNull();
    expect(result.cleaned.user_id).toBe(VALID_UUID);
    expect(result.cleaned).not.toBe(input);
  });

  it('preserves other fields untouched', () => {
    const result = repairUserId(
      { user_id: null, title: 't', folder_id: undefined, sync_version: 3 },
      VALID_UUID
    );
    expect(result.cleaned).toEqual({
      user_id: VALID_UUID,
      title: 't',
      folder_id: undefined,
      sync_version: 3
    });
  });
});
