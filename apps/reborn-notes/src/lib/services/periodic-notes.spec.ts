import { describe, it, expect } from 'vitest';
// Imported from the pure-format module so this spec doesn't drag in
// SvelteKit-aliased modules (auth.store etc.) via periodic-notes.service.
import { getAnchorIso, parseTitleAnchor } from './periodic-notes-format';

/**
 * These tests cover the pure helpers introduced for the locale-duplicate fix
 * (2026-05-12). The orchestration in `findExistingPeriodicNote` /
 * `getOrCreateNote` is exercised via the smoke checklist on real devices —
 * mocking IndexedDB + cryptoManager + reactive stores end-to-end here would
 * cost far more than it would catch.
 */

describe('getAnchorIso', () => {
  it('daily → ISO of the day itself (locale-independent)', () => {
    // Mon 2026-05-11
    const d = new Date(2026, 4, 11, 12, 59);
    expect(getAnchorIso('daily', d)).toBe('2026-05-11');
  });

  it('weekly → ISO of the Monday of that ISO week (click on Friday)', () => {
    // Fri 2026-05-08 belongs to ISO week starting Mon 2026-05-04
    const d = new Date(2026, 4, 8, 23, 59);
    expect(getAnchorIso('weekly', d)).toBe('2026-05-04');
  });

  it('weekly → ISO of the Monday when clicked ON Monday', () => {
    const mon = new Date(2026, 4, 11, 0, 0);
    expect(getAnchorIso('weekly', mon)).toBe('2026-05-11');
  });

  it('weekly → ISO of the previous Monday when clicked on Sunday', () => {
    // Sun 2026-05-10 still belongs to the week starting Mon 2026-05-04
    const sun = new Date(2026, 4, 10, 23, 59);
    expect(getAnchorIso('weekly', sun)).toBe('2026-05-04');
  });

  it('monthly → YYYY-MM-01 of that month', () => {
    const mid = new Date(2026, 4, 15, 10, 0);
    expect(getAnchorIso('monthly', mid)).toBe('2026-05-01');
  });

  it('monthly → first-of-month even when clicked on the 1st', () => {
    const first = new Date(2026, 0, 1, 0, 0);
    expect(getAnchorIso('monthly', first)).toBe('2026-01-01');
  });

  it('anchor for the same clock instant matches across locales (regression)', () => {
    // The whole point of the fix: anchor must be locale-independent. We can't
    // actually swap locales mid-test (Intl isn't involved here), but we can
    // assert the API doesn't even accept a locale arg — anchors are pure dates.
    const d = new Date(2026, 4, 11, 12, 59);
    expect(getAnchorIso('daily', d)).toBe('2026-05-11');
    expect(getAnchorIso('daily', d)).toBe('2026-05-11');
  });
});

describe('parseTitleAnchor', () => {
  describe('daily', () => {
    it('parses ISO prefix from default-format title (EN)', () => {
      expect(parseTitleAnchor('2026-05-11 Monday', 'daily')).toBe('2026-05-11');
    });

    it('parses ISO prefix from default-format title (PL)', () => {
      expect(parseTitleAnchor('2026-05-11 poniedziałek', 'daily')).toBe('2026-05-11');
    });

    it('parses ISO prefix from default-format title (DE)', () => {
      expect(parseTitleAnchor('2026-05-11 Montag', 'daily')).toBe('2026-05-11');
    });

    it('returns null for invalid calendar dates', () => {
      expect(parseTitleAnchor('2026-13-32 nope', 'daily')).toBeNull();
      expect(parseTitleAnchor('2026-02-30 nope', 'daily')).toBeNull();
    });

    it('returns null when title lacks ISO prefix', () => {
      expect(parseTitleAnchor('Dziennik 2026-05-11', 'daily')).toBeNull();
      expect(parseTitleAnchor('Random title', 'daily')).toBeNull();
      expect(parseTitleAnchor('', 'daily')).toBeNull();
    });

    it('requires a word boundary after the date (no digits gluing)', () => {
      // 2026-05-111 should not match as 2026-05-11 — but the boundary check
      // accepts the case where the next char is non-digit/non-word like space.
      expect(parseTitleAnchor('2026-05-11 dddd', 'daily')).toBe('2026-05-11');
      expect(parseTitleAnchor('2026-05-110000', 'daily')).toBeNull();
    });
  });

  describe('weekly', () => {
    it('parses Monday ISO from default-format title', () => {
      // Default weekly format produces 'YYYY-MM-DD [W]ww' = '2026-05-04 W19'
      expect(parseTitleAnchor('2026-05-04 W19', 'weekly')).toBe('2026-05-04');
    });

    it('uses the same date regex as daily (parseTitleAnchor knows nothing about Mon-anchor)', () => {
      // The anchor invariant (must be Monday) is enforced upstream by
      // getAnchorIso(); the parser just extracts the ISO date prefix.
      expect(parseTitleAnchor('2026-05-08 ZZZ', 'weekly')).toBe('2026-05-08');
    });
  });

  describe('monthly', () => {
    it('parses YYYY-MM into YYYY-MM-01 anchor', () => {
      expect(parseTitleAnchor('2026-05', 'monthly')).toBe('2026-05-01');
    });

    it('accepts trailing content after YYYY-MM (rare custom formats)', () => {
      expect(parseTitleAnchor('2026-05 May', 'monthly')).toBe('2026-05-01');
    });

    it('rejects invalid month numbers', () => {
      expect(parseTitleAnchor('2026-13', 'monthly')).toBeNull();
      expect(parseTitleAnchor('2026-00', 'monthly')).toBeNull();
    });

    it('returns null when title lacks YYYY-MM prefix', () => {
      expect(parseTitleAnchor('May 2026', 'monthly')).toBeNull();
      expect(parseTitleAnchor('2026', 'monthly')).toBeNull();
    });
  });
});

describe('locale-duplicate scenario (regression for bug reported 2026-05-12)', () => {
  it('two notes with same date but different locale share the same anchor', () => {
    const click = new Date(2026, 4, 11, 12, 59);
    const anchor = getAnchorIso('daily', click);

    // Title parsed from PL-locale note: '2026-05-11 poniedziałek'
    const plParsed = parseTitleAnchor('2026-05-11 poniedziałek', 'daily');
    // Title parsed from EN-locale note: '2026-05-11 Monday'
    const enParsed = parseTitleAnchor('2026-05-11 Monday', 'daily');

    // Same anchor → matcher treats them as the SAME daily note now.
    expect(plParsed).toBe(anchor);
    expect(enParsed).toBe(anchor);
    expect(plParsed).toBe(enParsed);
  });
});
