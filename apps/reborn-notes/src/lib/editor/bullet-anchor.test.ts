import { describe, expect, it } from 'vitest';
import {
  BULLET_ANCHOR,
  shouldInsertBulletAnchor,
  shouldStripAnchor
} from './bullet-anchor';

describe('shouldInsertBulletAnchor', () => {
  it('returns true for empty sub-bullet conversion (`* ` prefix, indent, no content)', () => {
    expect(shouldInsertBulletAnchor('* ', '   ', '')).toBe(true);
    expect(shouldInsertBulletAnchor('- ', '  ', '')).toBe(true);
    expect(shouldInsertBulletAnchor('+ ', '  ', '')).toBe(true);
  });

  it('returns false for top-level empty bullet — already parses as BulletList', () => {
    expect(shouldInsertBulletAnchor('* ', '', '')).toBe(false);
  });

  it('returns false when content remains after marker', () => {
    expect(shouldInsertBulletAnchor('* ', '   ', 'text')).toBe(false);
  });

  it('returns false for ordered prefix — empty sub-OrderedList parses fine', () => {
    expect(shouldInsertBulletAnchor('1. ', '   ', '')).toBe(false);
    expect(shouldInsertBulletAnchor('1) ', '   ', '')).toBe(false);
  });

  it('returns false for non-list prefixes (heading, blockquote)', () => {
    expect(shouldInsertBulletAnchor('# ', '   ', '')).toBe(false);
    expect(shouldInsertBulletAnchor('> ', '   ', '')).toBe(false);
  });
});

describe('shouldStripAnchor', () => {
  it('returns false when line has no anchor', () => {
    expect(shouldStripAnchor('  * hello')).toBe(false);
    expect(shouldStripAnchor('   1. text')).toBe(false);
  });

  it('returns false for the sentinel state — anchor present but no real content', () => {
    expect(shouldStripAnchor(`   * ${BULLET_ANCHOR}`)).toBe(false);
    expect(shouldStripAnchor(`  - ${BULLET_ANCHOR}`)).toBe(false);
  });

  it('returns true once the user has typed content', () => {
    expect(shouldStripAnchor(`   * h${BULLET_ANCHOR}`)).toBe(true);
    expect(shouldStripAnchor(`   * hello${BULLET_ANCHOR}`)).toBe(true);
    expect(shouldStripAnchor(`   * ${BULLET_ANCHOR}hello`)).toBe(true);
  });

  it('returns true even after the line was re-toggled to ordered', () => {
    expect(shouldStripAnchor(`   1. hello${BULLET_ANCHOR}`)).toBe(true);
  });

  it('returns false on non-list lines that happen to contain the anchor', () => {
    expect(shouldStripAnchor(`some text ${BULLET_ANCHOR}`)).toBe(false);
  });
});
