#!/usr/bin/env node
/**
 * RTL guard: physical-direction styling (`ml-2`, `text-left`, `margin-left`,
 * ...) breaks right-to-left layouts (Arabic, Hebrew, Persian UI and content).
 * The apps use logical equivalents (`ms-2`, `text-start`,
 * `margin-inline-start`, ...), which follow `<html dir>` automatically.
 *
 * Without this guard every new feature quietly reintroduces physical classes,
 * so the projects that render UI (reborn-notes, reborn-task, @reborn/ui) run
 * it from a spec in their own test target - `nx affected -t test` in CI picks
 * it up whenever one of them changes. See `rtl-direction.regression.spec.ts`.
 *
 * Usage (from the repo root):
 *   node scripts/check-rtl-direction.mjs                 # scan the default roots
 *   node scripts/check-rtl-direction.mjs <dir|file>...   # scan specific paths
 *   node scripts/check-rtl-direction.mjs --fix [paths]   # rewrite the mechanical cases
 *
 * Exit code 1 when violations remain. `--fix` rewrites the cases that have a
 * 1:1 logical equivalent; the rest (`space-x-*`, centring, ...) need a human.
 *
 * Intentionally physical code (coordinates measured from the viewport, a
 * widget pinned to `dir="ltr"`, a library that only takes physical values)
 * opts out with a pragma, ideally with a reason:
 *   - `rtl-ignore` anywhere on the same line,
 *   - `rtl-ignore-next-line` on the line above, or
 *   - a region between `rtl-ignore-start` and `rtl-ignore-end`
 *     (`// ...`, `<!-- ... -->` or a CSS comment). A centring
 *     `left-1/2 -translate-x-1/2` is direction-neutral and allowed as is.
 *
 * Inset shadows with an X offset (edge accents) are reported but not fixed:
 * the mirror is an extra `rtl:` class or `[dir=rtl]` rule.
 *
 * Out of scope (needs judgement, not a regex): `translate-x-*`, `fly({ x })`,
 * gradients, directional icons, swipe gestures and arrow-key handling.
 * Guideline: reapps-docs `guidelines/NN-rtl-layout.md`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_ROOTS = ['apps/reborn-notes/src', 'apps/reborn-task/src', 'packages/ui/src'];

const SCANNED_EXTENSIONS = new Set(['.svelte', '.ts', '.js', '.css']);
const SKIPPED_DIRS = new Set(['node_modules', '.svelte-kit', 'build', 'build-native', 'dist']);
// Specs assert on source text and test stubs never render; generated native
// template mirrors app.html.
const SKIPPED_FILE = /\.(test|spec)\.[jt]s$|\.d\.ts$|app\.native\.html$/;

// A class token starts after whitespace, a quote, `{`, a variant colon or the
// legacy `!` important prefix. Anything else (`.`, `-`, `/`, `[`, a letter)
// means we are inside a longer word: `slide-in-from-left-2`,
// `data-[side=left]:`, `--pl-x`, `i18n.key.text-left`.
const B = String.raw`(?<=^|[\s"'\x60{:!])`;

/**
 * Class rules apply to every scanned file type (Svelte markup, `cn()` / `tv()`
 * strings in TS, `@apply` in CSS).
 *
 * `fix` is a replacer for String#replace; rules without it are report-only.
 */
const CLASS_RULES = [
  {
    id: 'margin-padding',
    re: new RegExp(B + String.raw`(-?)(scroll-)?([mp])([lr])-(?=[a-z0-9\[(])`, 'g'),
    fix: (_m, neg, scroll, prop, side) => `${neg}${scroll ?? ''}${prop}${side === 'l' ? 's' : 'e'}-`,
    hint: 'ml/mr/pl/pr -> ms/me/ps/pe'
  },
  {
    id: 'inset',
    // `left-1/2` / `right-1/2` paired with `translate-x-1/2` is centring,
    // which is direction-neutral; matched by the report-only rule below.
    re: new RegExp(B + String.raw`(-?)(left|right)-(?!(?:1\/2|\[50%\])(?![\w\/]))(?=[a-z0-9\[(])`, 'g'),
    fix: (_m, neg, side) => `${neg}inset-${side === 'left' ? 's' : 'e'}-`,
    hint: 'left-*/right-* -> inset-s-*/inset-e-*'
  },
  {
    id: 'inset-half',
    re: new RegExp(B + String.raw`-?(left|right)-(?:1\/2|\[50%\])(?![\w\/])`, 'g'),
    allowIfLine: /translate-x-(?:1\/2|\[-?50%\])/,
    hint: 'left-1/2 without -translate-x-1/2 is not centring: use inset-s-1/2'
  },
  {
    id: 'text-align',
    re: new RegExp(B + String.raw`text-(left|right)(?![\w-])`, 'g'),
    fix: (_m, side) => `text-${side === 'left' ? 'start' : 'end'}`,
    hint: 'text-left/right -> text-start/end'
  },
  {
    id: 'rounded',
    re: new RegExp(B + String.raw`rounded-(tl|tr|bl|br|l|r)(?![a-z0-9])`, 'g'),
    fix: (_m, corner) =>
      `rounded-${{ l: 's', r: 'e', tl: 'ss', tr: 'se', bl: 'es', br: 'ee' }[corner]}`,
    hint: 'rounded-l/r/tl/tr/bl/br -> rounded-s/e/ss/se/es/ee'
  },
  {
    id: 'border',
    re: new RegExp(B + String.raw`border-(l|r)(?![a-z0-9])`, 'g'),
    fix: (_m, side) => `border-${side === 'l' ? 's' : 'e'}`,
    hint: 'border-l/r -> border-s/e'
  },
  {
    id: 'float-clear',
    re: new RegExp(B + String.raw`(float|clear)-(left|right)(?![\w-])`, 'g'),
    fix: (_m, prop, side) => `${prop}-${side === 'left' ? 'start' : 'end'}`,
    hint: 'float/clear-left/right -> -start/-end'
  },
  {
    // An inset shadow with an X offset is an edge accent (active-row bar),
    // and the offset is physical. Report-only: the mirror is a second class.
    id: 'shadow-x',
    re: new RegExp(B + String.raw`shadow-\[inset_-?(?:[1-9]|0?\.\d*[1-9])`, 'g'),
    allowIfLine: /rtl:shadow-\[/,
    hint: 'inset shadow X offset is physical: pair it with rtl:shadow-[inset_-N...]'
  },
  {
    id: 'space-x',
    re: new RegExp(B + String.raw`-?(space|divide)-x(?![\w-]*reverse)(?=[-\s"'\x60]|$)`, 'g'),
    allowIfLine: /(space|divide)-x-reverse/,
    hint: 'space-x/divide-x: use gap-* on flex/grid, or add rtl:space-x-reverse'
  }
];

/**
 * CSS rules apply to `.css` files and to `.svelte` files (style blocks,
 * `style="..."`, `style:prop`). Not to `.ts`: CSS in TS strings is the PDF
 * export stylesheet, rendered by html2canvas, which predates logical
 * properties.
 */
const CSS_RULES = [
  {
    id: 'css-box',
    re: /(?<![\w-])(margin|padding|border|scroll-margin|scroll-padding)-(left|right)(?![\w])/g,
    fix: (_m, prop, side) => `${prop}-inline-${side === 'left' ? 'start' : 'end'}`,
    hint: 'margin/padding/border-left -> -inline-start'
  },
  {
    id: 'css-radius',
    re: /(?<![\w-])border-(top|bottom)-(left|right)-radius/g,
    fix: (_m, v, h) =>
      `border-${v === 'top' ? 'start' : 'end'}-${h === 'left' ? 'start' : 'end'}-radius`,
    hint: 'border-top-left-radius -> border-start-start-radius'
  },
  {
    id: 'css-shadow-x',
    re: /(?<![\w-])box-shadow\s*:\s*inset\s+-?(?:[1-9]|0?\.\d*[1-9])/g,
    hint: 'inset box-shadow X offset is physical: add a [dir=rtl] rule with the negated offset'
  },
  {
    id: 'css-text-align',
    re: /(?<![\w-])text-align\s*:\s*(left|right)\b/g,
    fix: (m, side) => m.replace(side, side === 'left' ? 'start' : 'end'),
    hint: 'text-align: left -> start'
  },
  {
    id: 'css-float',
    re: /(?<![\w-])(float|clear)\s*:\s*(left|right)\b/g,
    fix: (m, _prop, side) => m.replace(side, side === 'left' ? 'inline-start' : 'inline-end'),
    hint: 'float: left -> inline-start'
  },
  {
    // Only inside a CSS context (style block / style attribute), where a bare
    // `left:` is the property and not a JS object key.
    id: 'css-inset',
    re: /(?<![\w-])(left|right)(\s*:)(?!:)/g,
    cssContextOnly: true,
    fix: (_m, side, colon) => `inset-inline-${side === 'left' ? 'start' : 'end'}${colon}`,
    hint: 'left:/right: -> inset-inline-start/end:'
  },
  {
    id: 'css-directive',
    re: /\bstyle:(left|right|(?:margin|padding)-(?:left|right))(?=[=\s/>])/g,
    fix: (_m, prop) =>
      `style:${prop
        .replace(/^left$/, 'inset-inline-start')
        .replace(/^right$/, 'inset-inline-end')
        .replace(/-left$/, '-inline-start')
        .replace(/-right$/, '-inline-end')}`,
    hint: 'style:left -> style:inset-inline-start'
  }
];

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|<!--)/;

/**
 * Per-line flag: does the line start inside a multi-line block comment
 * (`/* ... *\/` or `<!-- ... -->`)? Prose in comments ("right-aligned",
 * "the margin-left here ...") is not styling.
 */
function commentLines(lines) {
  let close = null;
  return lines.map((line) => {
    const startsInside = close !== null;
    let rest = line;
    for (;;) {
      if (close !== null) {
        const end = rest.indexOf(close);
        if (end === -1) break;
        rest = rest.slice(end + close.length);
        close = null;
      }
      // `/*` only counts after whitespace / line start: `accept="image/*"` and
      // `'**/*.md'` are strings, not comments.
      const jsMatch = /(?:^|\s)\/\*/.exec(rest);
      const js = jsMatch ? jsMatch.index + jsMatch[0].length - 2 : -1;
      const html = rest.indexOf('<!--');
      const open = [js, html].filter((n) => n !== -1).sort((a, b) => a - b)[0];
      if (open === undefined) break;
      close = open === js ? '*/' : '-->';
      rest = rest.slice(open + (open === js ? 2 : 4));
    }
    return startsInside;
  });
}

/**
 * Per-line flag: is the line opted out? `rtl-ignore` on the line,
 * `rtl-ignore-next-line` on the line above, or anywhere between
 * `rtl-ignore-start` and `rtl-ignore-end` (Svelte markup cannot hold a comment
 * between a tag's attributes, so a multi-line tag needs the region form).
 */
function ignoredLines(lines) {
  let inRegion = false;
  return lines.map((line, i) => {
    if (line.includes('rtl-ignore-start')) inRegion = true;
    const ignored =
      inRegion || line.includes('rtl-ignore') || (i > 0 && lines[i - 1].includes('rtl-ignore-next-line'));
    if (line.includes('rtl-ignore-end')) inRegion = false;
    return ignored;
  });
}

/**
 * Per-line flag: is this line inside a CSS context? `.css` files are CSS
 * throughout; in `.svelte` files it is the `<style>` block plus any line that
 * carries a `style=` attribute.
 */
function cssContextLines(text, ext) {
  const lines = text.split('\n');
  if (ext === '.css') return lines.map(() => true);
  if (ext !== '.svelte') return lines.map(() => false);
  let inStyle = false;
  return lines.map((line) => {
    if (/<style[\s>]/.test(line)) inStyle = true;
    const ctx = inStyle || /\bstyle=/.test(line);
    if (/<\/style>/.test(line)) inStyle = false;
    return ctx;
  });
}

function rulesFor(ext) {
  if (ext === '.css' || ext === '.svelte') return [...CLASS_RULES, ...CSS_RULES];
  return CLASS_RULES;
}

/**
 * Scan (and optionally rewrite) one file's text.
 * @param {string} text
 * @param {string} ext - extension incl. dot
 * @param {{ fix?: boolean }} [opts]
 * @returns {{ violations: Array<{ line: number, rule: string, match: string, hint: string }>, text: string }}
 */
export function scanText(text, ext, opts = {}) {
  const lines = text.split('\n');
  const cssCtx = cssContextLines(text, ext);
  const inComment = commentLines(lines);
  const ignored = ignoredLines(lines);
  const rules = rulesFor(ext);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    if (inComment[i] || ignored[i] || COMMENT_LINE.test(lines[i])) continue;
    for (const rule of rules) {
      if (rule.cssContextOnly && !cssCtx[i]) continue;
      if (rule.allowIfLine?.test(lines[i])) continue;
      if (opts.fix && rule.fix) {
        lines[i] = lines[i].replace(rule.re, rule.fix);
        continue;
      }
      for (const m of lines[i].matchAll(rule.re)) {
        violations.push({ line: i + 1, rule: rule.id, match: m[0], hint: rule.hint });
      }
    }
  }

  return { violations, text: lines.join('\n') };
}

function* walk(path) {
  const st = statSync(path);
  if (st.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    yield* walk(join(path, entry));
  }
}

/**
 * UI source files (`.svelte`, `.ts`, `.js`, `.css`; no specs, declarations or
 * build output) under the given roots - absolute, or relative to the repo
 * root. Returned as absolute paths. Also used by the specs' other source
 * guards (e.g. "no `{@html $t(...)}`").
 * @param {string[]} [roots]
 * @returns {string[]}
 */
export function listSourceFiles(roots = DEFAULT_ROOTS) {
  const files = [];
  for (const root of roots) {
    for (const file of walk(resolve(REPO_ROOT, root))) {
      if (SCANNED_EXTENSIONS.has(extname(file)) && !SKIPPED_FILE.test(file)) files.push(file);
    }
  }
  return files;
}

/** Path relative to the repo root, for reports. */
export function repoRelative(file) {
  return relative(REPO_ROOT, file);
}

/**
 * Scan files under the given roots (absolute, or relative to the repo root).
 * @param {string[]} [roots]
 * @param {{ fix?: boolean }} [opts]
 * @returns {Array<{ file: string, line: number, rule: string, match: string, hint: string }>}
 *   `file` is relative to the repo root.
 */
export function scanPaths(roots = DEFAULT_ROOTS, opts = {}) {
  const results = [];
  for (const file of listSourceFiles(roots)) {
    const original = readFileSync(file, 'utf-8');
    const { violations, text } = scanText(original, extname(file), opts);
    if (opts.fix && text !== original) writeFileSync(file, text);
    const rel = repoRelative(file);
    for (const v of violations) results.push({ file: rel, ...v });
  }
  return results;
}

/** Human-readable report, one violation per line. */
export function formatViolations(violations) {
  return violations
    .map((v) => `${v.file}:${v.line}  ${v.match.trim()}  [${v.rule}] ${v.hint}`)
    .join('\n');
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const roots = args.filter((a) => !a.startsWith('--'));
  if (fix) scanPaths(roots.length ? roots : DEFAULT_ROOTS, { fix: true });
  const violations = scanPaths(roots.length ? roots : DEFAULT_ROOTS);
  if (violations.length === 0) {
    console.log('check-rtl-direction: no physical-direction styling found.');
  } else {
    console.log(formatViolations(violations));
    console.log(
      `\ncheck-rtl-direction: ${violations.length} violation(s). Use logical utilities ` +
        '(ms/me, ps/pe, inset-s/e, text-start/end, rounded-s/e, border-s/e) or mark a ' +
        'deliberate physical value with `rtl-ignore-next-line: <reason>`.'
    );
    process.exitCode = 1;
  }
}
