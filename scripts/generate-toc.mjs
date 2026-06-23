#!/usr/bin/env node
/**
 * generate-toc.mjs - insert/refresh a table-of-contents block in Markdown docs.
 *
 * The TOC links to headings by the SAME slug reborn-notes stamps on rendered
 * headings (`apps/reborn-notes/src/lib/utils/heading-outline.ts`), so a synced
 * doc's `[Section](#slug)` links navigate inside re/notes. This script
 * re-implements `slugifyHeading` / `extractHeadings` (it runs in plain Node,
 * outside the app bundle) and self-checks parity against the shared fixture
 * (`--self-test`, run automatically before every generation). Keep the two
 * implementations in sync; the fixture is the contract.
 *
 * The managed block is delimited by HTML comments and carries its own bold
 * title, so it contributes NO heading of its own (no pollution of the outline /
 * anchor space) and a re-run is byte-identical when nothing changed - which is
 * exactly what folder sync's unchanged-skip needs to treat a refresh as a no-op.
 *
 *   <!-- toc -->
 *   **Spis treści**
 *
 *   - [Section](#section)
 *     - [Subsection](#subsection)
 *   <!-- /toc -->
 *
 * Usage:
 *   node scripts/generate-toc.mjs [options] <file.md...>
 *
 * Options:
 *   --check            Do not write; exit 1 if any file's TOC is out of date.
 *   --title <text>     TOC heading text (default: "Spis treści").
 *   --min <n>          Shallowest heading level to include (default: 2).
 *   --max <n>          Deepest heading level to include (default: 3).
 *   --min-headings <n> Minimum qualifying headings before a TOC is first
 *                      inserted into a doc that has none (default: 4). Docs that
 *                      already have a <!-- toc --> block are always refreshed.
 *   --self-test        Run the slug/extract parity check and exit.
 *   -h, --help         Show this help.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOC_OPEN = '<!-- toc -->';
const TOC_CLOSE = '<!-- /toc -->';
const TOC_BLOCK_RE = /<!-- toc -->[\s\S]*?<!-- \/toc -->/;

// ── Slug / heading extraction (MUST match heading-outline.ts) ────────────────

export function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function assignHeadingSlugs(texts) {
  const seen = new Map();
  return texts.map((text) => {
    const base = slugifyHeading(text) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSING_HASHES_RE = /[ \t]+#+[ \t]*$/;

export function extractHeadings(markdown) {
  const lines = markdown.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }
  const raw = [];
  let fence = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = FENCE_RE.exec(line);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const h = ATX_RE.exec(line);
    if (h) {
      const text = (h[2] ?? '').replace(CLOSING_HASHES_RE, '').trim();
      raw.push({ depth: h[1].length, text, line: i + 1 });
    }
  }
  const slugs = assignHeadingSlugs(raw.map((r) => r.text));
  return raw.map((r, idx) => ({ depth: r.depth, text: r.text, slug: slugs[idx], line: r.line }));
}

// ── TOC building ─────────────────────────────────────────────────────────────

/**
 * Escape the characters that would break a Markdown link label. The backslash
 * (Markdown's escape char) MUST be in the set, otherwise a literal `\` in the
 * heading text would "consume" a following bracket escape and close the label
 * early (e.g. `foo\]bar` -> `foo\\]bar` -> the `]` ends the label). A single
 * character class prefixes each matched char (`\`, `[`, `]`) with a backslash in
 * one left-to-right pass over the original string, so the order is correct.
 */
function escapeLabel(text) {
  return text.replace(/[\\[\]]/g, '\\$&');
}

/** Build the managed TOC block (without surrounding blank lines). */
function buildTocBlock(headings, { title, min, max }) {
  const included = headings.filter((h) => h.depth >= min && h.depth <= max);
  if (included.length === 0) return null;
  const base = Math.min(...included.map((h) => h.depth));
  const items = included.map((h) => {
    const indent = '  '.repeat(h.depth - base);
    return `${indent}- [${escapeLabel(h.text)}](#${h.slug})`;
  });
  return `${TOC_OPEN}\n**${title}**\n\n${items.join('\n')}\n${TOC_CLOSE}`;
}

/** Line index (0-based) after which a first-time TOC should be inserted. */
function firstInsertionLine(content, headings) {
  const lines = content.split('\n');
  // Past a leading YAML frontmatter block.
  let fmEnd = 0;
  if (lines[0]?.trim() === '---') {
    let i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    fmEnd = Math.min(i + 1, lines.length);
  }
  // Prefer just after the first H1 (the doc title); else after frontmatter.
  const h1 = headings.find((h) => h.depth === 1);
  return h1 ? h1.line : fmEnd;
}

/**
 * Return the document with its TOC inserted or refreshed. `null` means "no
 * change needed / not applicable" (no existing block and too few headings).
 */
function applyToc(content, opts) {
  const headings = extractHeadings(content);
  const block = buildTocBlock(headings, opts);

  if (TOC_BLOCK_RE.test(content)) {
    if (!block) {
      // Existing block but nothing to list now - drop it (and a trailing blank).
      const next = content.replace(new RegExp(`${TOC_BLOCK_RE.source}\\n?`), '');
      return next === content ? null : next;
    }
    const next = content.replace(TOC_BLOCK_RE, block);
    return next === content ? null : next;
  }

  if (!block) return null;
  const included = headings.filter((h) => h.depth >= opts.min && h.depth <= opts.max);
  if (included.length < opts.minHeadings) return null;

  const lines = content.split('\n');
  const at = firstInsertionLine(content, headings);
  const before = lines.slice(0, at);
  const after = lines.slice(at);
  // Ensure exactly one blank line on each side of the block.
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  const head = before.length ? [...before, ''] : [];
  const tail = after.length ? ['', ...after] : [''];
  return [...head, block, ...tail].join('\n');
}

// ── Self-test (parity with the app fixture) ──────────────────────────────────

function selfTest() {
  const fixtureUrl = new URL(
    '../apps/reborn-notes/src/lib/utils/__fixtures__/heading-slug-cases.json',
    import.meta.url
  );
  const fx = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
  const fails = [];

  for (const { text, slug } of fx.slugs) {
    const got = slugifyHeading(text);
    if (got !== slug) fails.push(`slugifyHeading(${JSON.stringify(text)}) = ${got} != ${slug}`);
  }
  const dedup = assignHeadingSlugs(fx.dedup.texts);
  if (JSON.stringify(dedup) !== JSON.stringify(fx.dedup.slugs)) {
    fails.push(`assignHeadingSlugs dedup = ${JSON.stringify(dedup)} != ${JSON.stringify(fx.dedup.slugs)}`);
  }
  const doc = extractHeadings(fx.doc.markdown);
  if (JSON.stringify(doc) !== JSON.stringify(fx.doc.headings)) {
    fails.push(`extractHeadings(doc) mismatch:\n  got ${JSON.stringify(doc)}\n  exp ${JSON.stringify(fx.doc.headings)}`);
  }

  // escapeLabel must escape the backslash too, not just the brackets.
  const escCases = [
    ['plain text', 'plain text'],
    ['a[b]c', 'a\\[b\\]c'],
    ['c:\\path', 'c:\\\\path']
  ];
  for (const [input, expected] of escCases) {
    const got = escapeLabel(input);
    if (got !== expected) {
      fails.push(`escapeLabel(${JSON.stringify(input)}) = ${JSON.stringify(got)} != ${JSON.stringify(expected)}`);
    }
  }

  if (fails.length) {
    console.error('generate-toc self-test FAILED (drifted from heading-outline.ts):');
    for (const f of fails) console.error('  - ' + f);
    return false;
  }
  return true;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    check: false,
    selfTest: false,
    help: false,
    title: 'Spis treści',
    min: 2,
    max: 3,
    minHeadings: 4,
    files: []
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--min') opts.min = Number(argv[++i]);
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--min-headings') opts.minHeadings = Number(argv[++i]);
    else if (a.startsWith('--')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else opts.files.push(a);
  }
  return opts;
}

const HELP = `generate-toc.mjs - insert/refresh a Markdown table of contents.

  node scripts/generate-toc.mjs [--check] [--title "Spis treści"] [--min 2] [--max 3] <file.md...>
  node scripts/generate-toc.mjs --self-test

Inserts a <!-- toc -->…<!-- /toc --> block after the first H1 (or refreshes an
existing one). Slugs match reborn-notes' heading anchors.`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // Parity guard always runs - a drifted slugifier would emit broken anchors.
  if (!selfTest()) process.exit(1);
  if (opts.selfTest) {
    console.log('generate-toc self-test passed.');
    return;
  }

  if (opts.files.length === 0) {
    console.error('No input files. See --help.');
    process.exit(2);
  }

  let changed = 0;
  for (const file of opts.files) {
    const original = readFileSync(file, 'utf8');
    const updated = applyToc(original, opts);
    if (updated === null || updated === original) {
      console.log(`unchanged  ${file}`);
      continue;
    }
    changed++;
    if (opts.check) {
      console.error(`out of date ${file}`);
    } else {
      writeFileSync(file, updated);
      console.log(`updated    ${file}`);
    }
  }

  if (opts.check && changed > 0) {
    console.error(`\n${changed} file(s) have a stale TOC. Run without --check to fix.`);
    process.exit(1);
  }
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
