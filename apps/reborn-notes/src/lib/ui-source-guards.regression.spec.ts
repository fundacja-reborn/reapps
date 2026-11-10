import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  formatViolations,
  listSourceFiles,
  repoRelative,
  scanPaths
} from '../../../../scripts/check-rtl-direction.mjs';

/**
 * Source guards for RTL readiness (reapps-docs planning/arabic-rtl-plan.md,
 * Phase 1). Kept in this project's own test target so `nx affected -t test`
 * runs them whenever apps/reborn-notes/src changes.
 */
const ROOT = 'apps/reborn-notes/src';

describe('UI source guards (apps/reborn-notes/src)', () => {
  it('uses logical direction utilities, not physical ones (RTL)', () => {
    // Fix: `node scripts/check-rtl-direction.mjs --fix apps/reborn-notes/src`, or mark a
    // deliberately physical value with `rtl-ignore-next-line: <reason>`.
    expect(formatViolations(scanPaths([ROOT]))).toBe('');
  });

  it('never renders a translation as raw HTML ({@html $t(...)})', () => {
    // Translations are escaped by Svelte. Rendering one through {@html} would
    // turn every locale file (soon including community translations) into an
    // XSS vector - build the markup in the component instead.
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) =>
            /\{@html\s+\$(t|_|json)\s*\(/.test(line) ? [`${repoRelative(file)}:${i + 1}`] : []
          )
      );
    expect(hits).toEqual([]);
  });

  it('sizes text in rem, not fixed px (text size setting, #511)', () => {
    // The interface scale is `font-size: N%` on <html>: text sized in px would
    // not grow with it. Write the rem equivalent (11px = 0.6875rem); in note
    // content use calc(Xrem * var(--rn-note-scale, 1)). Exempt: the service
    // worker's offline page (outside the app) and the PDF export (pt/em in a
    // fixed-width off-screen box, deliberately independent of the screen).
    const EXEMPT = ['/service-worker.ts', '/lib/services/export-import.service.ts'];
    const PX_TEXT = /text-\[\d+(\.\d+)?px\]|font-size:\s*\d+(\.\d+)?px|fontSize:\s*'\d+(\.\d+)?px'/;
    const hits = listSourceFiles([ROOT])
      .filter((file) => /\.(svelte|ts|css)$/.test(file) && !/\.(spec|test)\.ts$/.test(file))
      .filter((file) => !EXEMPT.some((suffix) => file.endsWith(suffix)))
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) => (PX_TEXT.test(line) ? [`${repoRelative(file)}:${i + 1}`] : []))
      );
    expect(hits).toEqual([]);
  });

  it('leaves text fields to the global bidi rule, without dir="auto"', () => {
    // An empty field with dir="auto" resolves to LTR, so in an Arabic UI the caret
    // starts on the left and jumps on the first letter. `unicode-bidi: plaintext`
    // in global.css follows the text and leaves an empty field in the UI direction.
    const hits = listSourceFiles([ROOT])
      .filter((file) => file.endsWith('.svelte'))
      .flatMap((file) =>
        /<(textarea|input)\b[^>]*\sdir="auto"/.test(readFileSync(file, 'utf-8'))
          ? [repoRelative(file)]
          : []
      );
    expect(hits).toEqual([]);
  });
});
