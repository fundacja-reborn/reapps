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
 * runs them whenever apps/reborn-task/src changes.
 */
const ROOT = 'apps/reborn-task/src';

describe('UI source guards (apps/reborn-task/src)', () => {
  it('uses logical direction utilities, not physical ones (RTL)', () => {
    // Fix: `node scripts/check-rtl-direction.mjs --fix apps/reborn-task/src`, or mark a
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
