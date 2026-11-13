import { describe, it, expect } from 'vitest';
import {
  ARCHIVED_AT_MAX_LENGTH,
  ARCHIVED_AT_SIZING,
  newArchivedAt,
  readArchivedAt,
  withArchivedAt
} from './archive-marker';

describe('archive marker', () => {
  it('newArchivedAt is an ISO timestamp of the sizing length', () => {
    const at = newArchivedAt();
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The codecs size their padding from this length - see ARCHIVED_AT_SIZING.
    expect(at.length).toBe(ARCHIVED_AT_SIZING.length);
    expect(readArchivedAt({ archived_at: at })).toBe(at);
  });

  it('readArchivedAt accepts a parseable timestamp within the cap', () => {
    expect(readArchivedAt({ archived_at: '2026-11-13T09:27:41.123Z' })).toBe(
      '2026-11-13T09:27:41.123Z'
    );
    expect(readArchivedAt({ archived_at: '2026-11-13' })).toBe('2026-11-13');
  });

  it('reads anything else as "not archived" (the item stays visible)', () => {
    expect(readArchivedAt(null)).toBeUndefined();
    expect(readArchivedAt(undefined)).toBeUndefined();
    expect(readArchivedAt({})).toBeUndefined();
    expect(readArchivedAt({ archived_at: '' })).toBeUndefined();
    expect(readArchivedAt({ archived_at: 'yesterday' })).toBeUndefined();
    expect(readArchivedAt({ archived_at: true })).toBeUndefined();
    expect(readArchivedAt({ archived_at: 1794558449 })).toBeUndefined();
    expect(
      readArchivedAt({ archived_at: `2026-11-13T09:27:41.123Z${' '.repeat(ARCHIVED_AT_MAX_LENGTH)}` })
    ).toBeUndefined();
  });

  it('withArchivedAt sets and removes the marker, keeping every other field', () => {
    const bundle = { color: 'red', future_field: 7 } as { archived_at?: string };
    const archived = withArchivedAt(bundle, '2026-11-13T09:27:41.123Z');
    expect(archived).toEqual({
      color: 'red',
      future_field: 7,
      archived_at: '2026-11-13T09:27:41.123Z'
    });
    expect(withArchivedAt(archived, undefined)).toEqual({ color: 'red', future_field: 7 });
    // The input is not mutated.
    expect(bundle).toEqual({ color: 'red', future_field: 7 });
  });
});
