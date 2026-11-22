import { describe, it, expect } from 'vitest';
import { modShortcut, usesCommandKey } from './shortcut-label';

describe('usesCommandKey', () => {
  it.each([
    ['macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'],
    ['iPadOS (desktop user agent)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15'],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15']
  ])('is true on %s', (_label, userAgent) => {
    expect(usesCommandKey({ userAgent })).toBe(true);
  });

  it.each([
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0'],
    ['Android', 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/131.0']
  ])('is false on %s', (_label, userAgent) => {
    expect(usesCommandKey({ userAgent })).toBe(false);
  });

  it('is false without a navigator', () => {
    expect(usesCommandKey(undefined)).toBe(false);
  });
});

describe('modShortcut', () => {
  it('writes Cmd as the symbol and Ctrl as a word', () => {
    expect(modShortcut('K', true)).toBe('⌘K');
    expect(modShortcut('K', false)).toBe('Ctrl+K');
  });
});
