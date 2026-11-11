import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  formatViolations,
  listSourceFiles,
  repoRelative,
  scanPaths
} from '../../../scripts/check-rtl-direction.mjs';

/**
 * Source guards for RTL readiness (reapps-docs planning/arabic-rtl-plan.md,
 * Phase 1). Kept in this project's own test target so `nx affected -t test`
 * runs them whenever packages/ui/src changes.
 */
const ROOT = 'packages/ui/src';

/**
 * bits-ui roots whose `dir` prop defaults to "ltr" and ends up as a `dir`
 * attribute on what they render (menus put it on the menu element, so a `dir`
 * on Content alone is not enough - #524). Our wrapper of each root must pass
 * the UI direction. Keys: the bits-ui namespace; values: its folder in
 * bits-ui's dist (`menu` is the shared root of DropdownMenu).
 */
const ROOTS_WITH_DIR: Record<string, string> = {
  DropdownMenu: 'menu',
  ContextMenu: 'context-menu',
  Menubar: 'menubar',
  NavigationMenu: 'navigation-menu',
  Slider: 'slider'
};

/** bits-ui folders with a `dir = "ltr"` default that are not a root we wrap. */
const DIR_DEFAULTS_HANDLED_ELSEWHERE = new Set([
  // Floating content of popover, select, tooltip...: the *-content.svelte
  // wrappers pass `dir` (guideline 74).
  'utilities',
  // Not part of @reborn/ui. Wrap it like the roots above when adding it.
  'scroll-area'
]);

/** bits-ui folders (under dist/bits) with a component defaulting `dir` to "ltr". */
function bitsFoldersWithLtrDefault(): string[] {
  const require = createRequire(import.meta.url);
  const bits = join(dirname(require.resolve('bits-ui')), 'bits');
  const folders = new Set<string>();
  for (const entry of readdirSync(bits, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.svelte')) continue;
    if (/\bdir = "ltr"/.test(readFileSync(join(bits, entry), 'utf8'))) {
      folders.add(entry.split(/[\\/]/)[0]);
    }
  }
  return [...folders].sort();
}

describe('UI source guards (packages/ui/src)', () => {
  it('uses logical direction utilities, not physical ones (RTL)', () => {
    // Fix: `node scripts/check-rtl-direction.mjs --fix packages/ui/src`, or mark a
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

  describe('bits-ui roots that default to left-to-right (#524)', () => {
    const files = listSourceFiles([ROOT]).map((file) => ({
      file: repoRelative(file),
      text: readFileSync(file, 'utf-8')
    }));

    it('every such bits-ui root is on the list below', () => {
      // A bits-ui update gave another component a `dir` prop: wrap its root
      // like dropdown-menu.svelte and add it to ROOTS_WITH_DIR.
      const known = new Set([...Object.values(ROOTS_WITH_DIR), ...DIR_DEFAULTS_HANDLED_ELSEWHERE]);
      expect(bitsFoldersWithLtrDefault().filter((folder) => !known.has(folder))).toEqual([]);
    });

    it.each(Object.keys(ROOTS_WITH_DIR))('%s: the root wrapper passes the UI direction', (name) => {
      const primitive = `${name}Primitive.Root`;
      // Exported as is (`const Root = DropdownMenuPrimitive.Root`), the root stays "ltr".
      const reexported = files
        .filter(({ text }) => new RegExp(`=\\s*${primitive}\\s*;`).test(text))
        .map(({ file }) => file);
      expect(reexported).toEqual([]);

      const wrappers = files.filter(({ text }) => text.includes(`<${primitive}`));
      expect(wrappers.map(({ file }) => file)).not.toEqual([]);
      for (const { file, text } of wrappers) {
        expect(text, file).toContain('dir={dir ?? $textDirection}');
      }
    });
  });
});
