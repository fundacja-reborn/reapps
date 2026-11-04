import { describe, it, expect } from 'vitest';
import { scanText } from '../../../scripts/check-rtl-direction.mjs';

/**
 * Unit tests for the RTL guard itself (scripts/check-rtl-direction.mjs): the
 * per-project ui-source-guards specs trust it to flag physical-direction
 * styling and - just as important - to leave everything else alone, because
 * `--fix` rewrites files in place.
 */
const flagged = (text: string, ext = '.svelte') =>
  scanText(text, ext).violations.map((v) => v.match.trim());
const fixed = (text: string, ext = '.svelte') => scanText(text, ext, { fix: true }).text;

describe('check-rtl-direction scanner', () => {
  it('rewrites physical utilities to logical ones', () => {
    expect(fixed('<div class="ml-2 -mr-1 pl-[3px] pr-4 sm:left-0 right-auto">')).toBe(
      '<div class="ms-2 -me-1 ps-[3px] pe-4 sm:inset-s-0 inset-e-auto">'
    );
    expect(fixed('<p class="text-left md:text-right rounded-l-lg rounded-tr border-l-2 border-r">')).toBe(
      '<p class="text-start md:text-end rounded-s-lg rounded-se border-s-2 border-e">'
    );
    expect(fixed("cn('hover:ml-auto', open && 'pl-2')", '.ts')).toBe("cn('hover:ms-auto', open && 'ps-2')");
  });

  it('rewrites physical CSS in style blocks and style attributes', () => {
    expect(fixed('<style>\n  .x { margin-left: 1em; text-align: right; left: 0; }\n</style>')).toBe(
      '<style>\n  .x { margin-inline-start: 1em; text-align: end; inset-inline-start: 0; }\n</style>'
    );
    expect(fixed('<div style="padding-left: {d}rem; left: {d}rem">')).toBe(
      '<div style="padding-inline-start: {d}rem; inset-inline-start: {d}rem">'
    );
  });

  it('leaves look-alikes alone', () => {
    const untouched = [
      "toLocaleString('pl-PL')", // locale tag, not padding
      'class="items-center place-items-start rounded-lg border-red-500"',
      'class="data-[side=left]:slide-in-from-right-2 slide-out-to-left"',
      'class="var(--pl-x) i18n.key.text-left"',
      "const pos = { left: 0, right: 0 };", // JS object outside a style context
      'class="transition-[left,right,width]"'
    ];
    for (const text of untouched) expect(flagged(text), text).toEqual([]);
    // CSS in TS (the html2canvas PDF stylesheet) is out of scope.
    expect(flagged('const css = `p { margin-left: 1em }`;', '.ts')).toEqual([]);
  });

  it('allows centring and honours the opt-out pragmas', () => {
    expect(flagged('class="left-1/2 -translate-x-1/2"')).toEqual([]);
    expect(flagged('class="left-[50%] translate-x-[-50%]"')).toEqual([]);
    expect(flagged('class="left-1/2"')).toEqual(['left-1/2']);

    expect(flagged('<!-- rtl-ignore-next-line: viewport coords -->\n<div class="left-2">')).toEqual([]);
    expect(flagged('<div class="left-2"> <!-- rtl-ignore -->')).toEqual([]);
    expect(
      flagged('<!-- rtl-ignore-start -->\n<div\n  class="left-2"\n  style="left: 0">\n<!-- rtl-ignore-end -->\n<b class="ml-1">')
    ).toEqual(['ml-']);
  });

  it('skips prose in comments, including multi-line block comments', () => {
    expect(flagged('/* the margin-left here\n   right-aligned text */\n<b>', '.svelte')).toEqual([]);
    expect(flagged('// pl-4 in a comment', '.ts')).toEqual([]);
    // `/*` inside a string is not a comment opener.
    expect(flagged('<input accept="image/*" class="ml-2">')).toEqual(['ml-']);
  });

  it('reports space-x / divide-x unless reversed for RTL', () => {
    expect(flagged('class="flex space-x-2"')).toEqual(['space-x']);
    expect(flagged('class="flex divide-x rtl:divide-x-reverse"')).toEqual([]);
    // report-only: --fix leaves them for a human
    expect(fixed('class="flex space-x-2"')).toBe('class="flex space-x-2"');
  });
});
