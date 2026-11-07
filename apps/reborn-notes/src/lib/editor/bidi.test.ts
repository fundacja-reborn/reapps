import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { lineDirection } from './bidi';

const doc = (...lines: string[]) => Text.of(lines);

describe('lineDirection', () => {
  it('leaves a line with only a direction mark to the browser', () => {
    expect(lineDirection(doc(String.fromCodePoint(0x200f)), 1, 'ltr')).toBe('auto');
  });

  it('takes the direction of an empty line from a direction mark above', () => {
    expect(lineDirection(doc(`${String.fromCodePoint(0x200f)}hello`, ''), 2, 'ltr')).toBe('rtl');
  });

  it('leaves a line with text to dir="auto"', () => {
    expect(lineDirection(doc('hello'), 1, 'rtl')).toBe('auto');
    expect(lineDirection(doc('مرحبا'), 1, 'ltr')).toBe('auto');
  });

  it('starts an empty note in the UI direction, so the caret does not jump (#482)', () => {
    expect(lineDirection(doc(''), 1, 'rtl')).toBe('rtl');
    expect(lineDirection(doc(''), 1, 'ltr')).toBe('ltr');
  });

  it('keeps a new empty line on the side of the paragraph above it', () => {
    expect(lineDirection(doc('مرحبا', ''), 2, 'ltr')).toBe('rtl');
    expect(lineDirection(doc('hello', ''), 2, 'rtl')).toBe('ltr');
  });

  it('uses the nearest line with text, skipping blank ones', () => {
    expect(lineDirection(doc('hello', 'مرحبا', '', '', ''), 5, 'ltr')).toBe('rtl');
    expect(lineDirection(doc('مرحبا', 'hello', '', ''), 4, 'rtl')).toBe('ltr');
  });

  it('treats digits and punctuation as having no direction of their own', () => {
    expect(lineDirection(doc('مرحبا', '123'), 2, 'ltr')).toBe('rtl');
    expect(lineDirection(doc('مرحبا', '---'), 2, 'ltr')).toBe('rtl');
  });

  it('applies to a list or heading marker with no text yet', () => {
    expect(lineDirection(doc('مرحبا', '- '), 2, 'ltr')).toBe('rtl');
    expect(lineDirection(doc('مرحبا', '# '), 2, 'ltr')).toBe('rtl');
    expect(lineDirection(doc('مرحبا', '1. '), 2, 'ltr')).toBe('rtl');
  });

  it('does not look at lines below', () => {
    expect(lineDirection(doc('', 'مرحبا'), 1, 'ltr')).toBe('ltr');
  });

  it('falls back to the UI direction after a long blank gap', () => {
    const lines = ['مرحبا', ...Array.from({ length: 150 }, () => '')];
    expect(lineDirection(doc(...lines), 151, 'ltr')).toBe('ltr');
    expect(lineDirection(doc(...lines), 100, 'ltr')).toBe('rtl');
  });
});
