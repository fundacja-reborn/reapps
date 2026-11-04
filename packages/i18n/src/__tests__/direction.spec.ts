import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { getTextDirection, inlineSide, isTextDirection } from '../direction';
import {
  applyDocumentLocale,
  readDirectionOverride,
  textDirection,
  DIRECTION_OVERRIDE_STORAGE_KEY
} from '../document-direction';
import { SUPPORTED_LOCALES } from '../config';

describe('getTextDirection', () => {
  it('maps RTL languages to rtl, including region and underscore variants', () => {
    for (const tag of ['ar', 'ar-EG', 'AR', 'he', 'he_IL', 'fa', 'ur', 'ckb']) {
      expect(getTextDirection(tag), tag).toBe('rtl');
    }
  });

  it('maps everything else - including garbage - to ltr', () => {
    for (const tag of ['en', 'pl', 'de-AT', 'arn', 'hr', '', undefined, null, 42]) {
      expect(getTextDirection(tag), String(tag)).toBe('ltr');
    }
  });

  it('keeps every shipped locale LTR until an RTL locale is deliberately added', () => {
    // Guards the assumption Phase 1 ships under: the RTL layout is reachable
    // only via the ?dir=rtl override. Adding `ar` (Phase 2) flips this test on
    // purpose - update it together with SUPPORTED_LOCALES.
    expect(SUPPORTED_LOCALES.filter((l) => getTextDirection(l) === 'rtl')).toEqual([]);
  });

  it('inlineSide maps logical sides to physical ones', () => {
    expect(inlineSide('end', 'ltr')).toBe('right');
    expect(inlineSide('start', 'ltr')).toBe('left');
    expect(inlineSide('end', 'rtl')).toBe('left');
    expect(inlineSide('start', 'rtl')).toBe('right');
  });

  it('isTextDirection accepts exactly ltr/rtl', () => {
    expect(isTextDirection('ltr')).toBe(true);
    expect(isTextDirection('rtl')).toBe(true);
    expect(isTextDirection('auto')).toBe(false);
    expect(isTextDirection(undefined)).toBe(false);
  });
});

describe('readDirectionOverride', () => {
  beforeEach(() => localStorage.clear());

  it('returns null with no param and nothing stored', () => {
    expect(readDirectionOverride('')).toBeNull();
  });

  it('persists ?dir=rtl so it survives client-side navigation', () => {
    expect(readDirectionOverride('?dir=rtl')).toBe('rtl');
    expect(localStorage.getItem(DIRECTION_OVERRIDE_STORAGE_KEY)).toBe('rtl');
    expect(readDirectionOverride('?other=1')).toBe('rtl');
  });

  it('accepts ?dir=ltr (forces LTR under an RTL locale)', () => {
    expect(readDirectionOverride('?dir=LTR')).toBe('ltr');
  });

  it('clears the override with ?dir=auto (or any other value)', () => {
    readDirectionOverride('?dir=rtl');
    expect(readDirectionOverride('?dir=auto')).toBeNull();
    expect(localStorage.getItem(DIRECTION_OVERRIDE_STORAGE_KEY)).toBeNull();
    expect(readDirectionOverride('')).toBeNull();
  });

  it('ignores a corrupted stored value', () => {
    localStorage.setItem(DIRECTION_OVERRIDE_STORAGE_KEY, 'sideways');
    expect(readDirectionOverride('')).toBeNull();
  });
});

describe('applyDocumentLocale', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.lang = '';
  });

  it('sets <html lang> and <html dir> from the locale', () => {
    expect(applyDocumentLocale('en')).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');

    expect(applyDocumentLocale('ar')).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(get(textDirection)).toBe('rtl');
  });

  it('lets the debug override win over the locale direction', () => {
    expect(applyDocumentLocale('en', 'rtl')).toBe('rtl');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('rtl');
    expect(get(textDirection)).toBe('rtl');

    applyDocumentLocale('en');
    expect(get(textDirection)).toBe('ltr');
  });
});
