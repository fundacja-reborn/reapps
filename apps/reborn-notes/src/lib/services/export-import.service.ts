/**
 * Export / Import service for Reborn Notes.
 *
 * Handles:
 *  - Single note  → .md file download
 *  - Folder / all → .zip archive download (uses JSZip via dynamic import)
 *  - Full backup  → .json file download (raw IndexedDB data)
 *  - Import       → .md file(s) → new notes
 */
import type {
  NoteDecrypted,
  NoteEncrypted,
  NoteStoredLocal,
  NoteSensitiveMetadata,
  FolderEncrypted,
  FolderWithChildren,
  TagEncrypted
} from '@reborn/types';
import {
  schemas,
  MAX_NOTE_CONTENT_BYTES
} from '@reborn/types';
import {
  noteStore,
  folderStore,
  tagStore,
  noteTagStore,
  noteTagOperations,
  noteTagQueries,
  type NoteTag
} from '@reborn/storage';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { createMarkdownListRenderers } from '$lib/utils/markdown-to-html';
import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth.store';
import {
  decryptWithPasswordOrPhrase,
  encryptWithPassword,
  cryptoManager,
  isEncryptedDataReadable
} from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import * as NoteService from './note.service';
import * as FolderService from './folder.service';
import * as TagService from './tag.service';
import { pushNote, pushPendingItems } from './notes-sync.service';
import { noteIndex } from './note-index.svelte';
import {
  parseMarkdownFile,
  extractFolderSegments,
  containsHiddenSegment,
  pickImportTimestamps
} from './markdown-import-utils';
import {
  computeRenamedTitle,
  pickOverwriteTarget,
  isImportUnchanged,
  mergeTagIds,
  tagSetsEqual,
  rememberTitle,
  folderKey,
  type DuplicateStrategy,
  type TagOverwriteMode,
  type TitleLookup
} from './import-dedup-utils';
import { sanitizeMarkdownContent, sanitizeTags } from '$lib/utils/markdown-sanitizer';
import { rewriteInterNoteLinks, buildWikilinkIndex } from './internal-link-rewrite-utils';
import { shouldRestoreFromTrash, shouldRelinkToBackupFolder } from './export-import-trash-utils';
import {
  normalizeNullToUndefined,
  formatZodIssues,
  FOLDER_OPTIONAL_FIELDS,
  NOTE_OPTIONAL_FIELDS,
  TAG_OPTIONAL_FIELDS
} from './import-normalize-utils';
import {
  buildPortablePayload,
  reencryptPortablePayload,
  type PortablePayload
} from './portable-backup-utils';

const logger = createLogger('ExportImport');

/** Max import file size: 100 MB (aligned with per-user storage quota). */
const MAX_IMPORT_FILE_SIZE = 100 * 1024 * 1024;

/** UUID v4 regex (strict: 8-4-4-4-12 hex chars). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Attempt to fix common UUID corruptions found in IndexedDB data:
 * - Missing leading zeros in groups (e.g., 7-char first group → pad to 8)
 * Returns the UUID unchanged if it's already valid, or `null` if unrepairable.
 */
function tryFixUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (UUID_RE.test(value)) return value; // already valid

  const parts = value.split('-');
  if (parts.length !== 5) return null;

  const expectedLengths = [8, 4, 4, 4, 12];
  const fixed = parts.map((part, i) => {
    const expected = expectedLengths[i];
    if (part.length === expected) return part;
    if (part.length < expected && part.length >= expected - 2) {
      // Pad with leading zeros (most likely corruption: dropped leading '0')
      return part.padStart(expected, '0');
    }
    return null; // too short or too long — unrepairable
  });

  if (fixed.includes(null)) return null;
  const result = fixed.join('-');
  return UUID_RE.test(result) ? result : null;
}

/**
 * Pre-process a raw entity object: attempt to fix UUID fields before Zod
 * validation. Returns the object with fixed UUIDs and a list of field
 * names that were repaired (for logging).
 */
function fixEntityUuids(
  raw: Record<string, unknown>,
  uuidFields: string[]
): { fixed: Record<string, unknown>; repairedFields: string[] } {
  const fixed = { ...raw };
  const repairedFields: string[] = [];
  for (const field of uuidFields) {
    if (field in fixed && typeof fixed[field] === 'string' && !UUID_RE.test(fixed[field] as string)) {
      const repaired = tryFixUuid(fixed[field]);
      if (repaired) {
        fixed[field] = repaired;
        repairedFields.push(field);
      }
    }
  }
  return { fixed, repairedFields };
}


// ── Helpers ─────────────────────────────────────────────────────────────────

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (__REBORN_NATIVE__) {
    // WKWebView silently ignores `<a download>` on blob: URLs, so the native
    // shell routes exports through the app cache + system share sheet instead
    // (see native-file-export.ts). Dynamic import keeps the web bundle clean.
    const { exportFileNative } = await import('$lib/utils/native-file-export');
    await exportFileNative(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Windows reserved device names - refused by the OS as a file's base name
 * (the part before the first dot), in any casing, so `con.md` is as broken
 * as `CON`.
 */
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Make a note title / folder name safe as a single path segment in a download
 * or ZIP entry. Beyond stripping separator and control characters, dot-only
 * names must not survive: a folder named ".." becomes a `../note.md` ZIP entry
 * that a naive extractor writes OUTSIDE the target directory (zip-slip), and
 * "." vanishes. Trailing dots and Windows reserved device names would make the
 * archive fail to extract on Windows. (Audit 012 N5.)
 *
 * Exported for unit tests.
 */
export function sanitizeFilename(name: string): string {
  let safe = name
    .replace(/[\\/:*?"<>|\n\r\t]/g, '_')
    .trim()
    .slice(0, 100)
    .replace(/[\s.]+$/, '');
  if (WINDOWS_RESERVED_NAME_RE.test(safe)) safe = `_${safe}`;
  return safe || 'untitled';
}

function buildFrontmatter(note: NoteDecrypted, tagNames: string[]): string {
  const escapeYaml = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = [
    '---',
    `title: "${escapeYaml(note.title)}"`,
    `created: ${note.created_at}`,
    `modified: ${note.updated_at}`
  ];
  if (tagNames.length > 0) {
    lines.push(`tags: [${tagNames.map((t) => `"${escapeYaml(t)}"`).join(', ')}]`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function buildMarkdownContent(note: NoteDecrypted, tagNames: string[]): string {
  return buildFrontmatter(note, tagNames) + note.content;
}

/** Flatten folder tree to map: id → relative path (e.g. "Work/Projects"). */
function buildFolderPathMap(nodes: FolderWithChildren[], prefix = ''): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of nodes) {
    const segment = sanitizeFilename(f.name);
    const path = prefix ? `${prefix}/${segment}` : segment;
    map.set(f.id, path);
    for (const [k, v] of buildFolderPathMap(f.children ?? [], path)) {
      map.set(k, v);
    }
  }
  return map;
}

// ── Export ───────────────────────────────────────────────────────────────────

/** Export a single note as a .md file download. */
export async function exportNoteAsMarkdown(
  note: NoteDecrypted,
  tagNames: string[] = []
): Promise<void> {
  const content = buildMarkdownContent(note, tagNames);
  const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' });
  await downloadBlob(blob, `${sanitizeFilename(note.title)}.md`);
}

/**
 * Export a raw markdown string as a .md download. Unlike `exportNoteAsMarkdown`
 * this adds NO frontmatter and takes the content verbatim - it exports a share
 * snapshot's FROZEN markdown (the exact text that was shared at snapshot time),
 * not a live note. Reuses the same download + filename-sanitising path.
 */
export async function exportMarkdownString(title: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' });
  await downloadBlob(blob, `${sanitizeFilename(title)}.md`);
}

/**
 * Style block injected into the off-screen container that jsPDF rasterizes.
 * html2canvas reads computed styles from a real DOM element, so the rules
 * below define the visual output. No `@page` — page geometry is set on the
 * jsPDF instance (`format: 'a4'`, `margin: [40,40,40,40]`).
 *
 * Fonts are kept to system stacks. Web fonts that haven't been used elsewhere
 * on the page may not be loaded by the time html2canvas snapshots, which
 * silently substitutes them and can shift line widths.
 */
const PDF_STYLES = `
.reborn-pdf-root, .reborn-pdf-root * { box-sizing: border-box; }
.reborn-pdf-root {
  color: #000;
  background: #fff;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 11pt;
  line-height: 1.55;
  word-spacing: normal;
  letter-spacing: normal;
}
.reborn-pdf-root h1, .reborn-pdf-root h2, .reborn-pdf-root h3,
.reborn-pdf-root h4, .reborn-pdf-root h5, .reborn-pdf-root h6 {
  line-height: 1.25;
  font-weight: 600;
  overflow-wrap: break-word;
}
/* Sizes use em (relative to body 11pt), not rem (which resolves against
   the host page's <html> font-size — typically 16px — and would push
   headings past the off-screen container's wrapping boundary, triggering
   html2canvas-pro's multi-line text-renderer bug). */
.reborn-pdf-root .reborn-pdf-body h1 { font-size: 1.5em;  margin: 0.5em 0 0.4em; }
.reborn-pdf-root .reborn-pdf-body h1:first-child { margin-top: 0; }
.reborn-pdf-root .reborn-pdf-body h2 { font-size: 1.3em;  margin: 1em 0 0.4em; }
.reborn-pdf-root .reborn-pdf-body h3 { font-size: 1.15em; margin: 0.8em 0 0.3em; }
.reborn-pdf-root .reborn-pdf-body h4 { font-size: 1em;    margin: 0.8em 0 0.3em; }
.reborn-pdf-root p { margin: 0 0 0.75em; }
.reborn-pdf-root a { color: #1d4ed8; text-decoration: underline; word-break: break-word; }
/* List markers rendered via ::before + CSS counters rather than the native
   ::marker pseudo. html2canvas-pro 2.0.2 paints the native marker by drawing
   right-aligned text anchored at the <li>'s left edge (esm.js:9486–9495);
   for our 800px off-screen container the glyph sometimes lands outside the
   captured region or is suppressed entirely. Pseudo-element content with
   counter() is rendered as ordinary positioned text and renders reliably. */
.reborn-pdf-root ul, .reborn-pdf-root ol {
  list-style: none;
  margin: 0 0 0.75em 0;
  padding-left: 1.5em;
}
.reborn-pdf-root ol { counter-reset: pdf-ol; }
.reborn-pdf-root li { position: relative; }
.reborn-pdf-root ul > li::before {
  content: '•';
  position: absolute;
  left: -1em;
  width: 1em;
  text-align: left;
}
.reborn-pdf-root ol > li { counter-increment: pdf-ol; }
.reborn-pdf-root ol > li::before {
  content: counter(pdf-ol) '.';
  position: absolute;
  left: -1.5em;
  width: 1.25em;
  text-align: right;
  padding-right: 0.25em;
}
.reborn-pdf-root li + li { margin-top: 0.2em; }
/* GFM task list items — drop the synthetic ::before bullet (the checkbox
   takes its place). The checkbox itself is pulled into the bullet zone via
   negative margin-left below; keeping the li's box untouched preserves the
   parent ul's padding-left: 1.5em per nested level, so deeper task-list
   nesting stays visibly indented. The previous approach (margin-left:
   -1.5em on li.task-list-item) cancelled the per-level indent exactly,
   collapsing every task item to column 0 in the PDF.
   Strikethrough scopes to the parent's own inline wrapper so a checked
   parent does not visually mark its nested children as done. */
.reborn-pdf-root li.task-list-item { list-style: none; }
.reborn-pdf-root li.task-list-item::before { content: none; }
.reborn-pdf-root li.task-list-item-checked > .task-list-item-content {
  text-decoration: line-through;
  color: #555;
}
.reborn-pdf-root .task-list-item-checkbox { margin-right: 0.4em; margin-left: -1.4em; vertical-align: middle; }
.reborn-pdf-root blockquote {
  margin: 0 0 0.75em;
  padding: 0.4em 0.9em;
  border-left: 3px solid #999;
  color: #444;
}
.reborn-pdf-root code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875em;
  background: #f3f3f3;
  padding: 0.1em 0.35em;
  border-radius: 3px;
}
.reborn-pdf-root pre {
  margin: 0 0 0.75em;
  padding: 0.75em;
  background: #f3f3f3;
  border-radius: 4px;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.reborn-pdf-root pre code { background: transparent; padding: 0; }
.reborn-pdf-root table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 0.75em;
}
.reborn-pdf-root th, .reborn-pdf-root td {
  border: 1px solid #ccc;
  padding: 0.4em 0.6em;
  text-align: left;
}
.reborn-pdf-root th { background: #f3f3f3; font-weight: 600; }
.reborn-pdf-root img { max-width: 100%; height: auto; }
.reborn-pdf-root hr { margin: 1em 0; border: none; border-top: 1px solid #ccc; }
`.trim();

/**
 * Export a single note as PDF, generated entirely client-side.
 *
 * Pipeline: marked → DOMPurify → off-screen DOM → html2canvas-pro (raster) →
 * jsPDF (manual slice pagination via addImage). Plaintext never leaves the
 * device.
 *
 * Why direct html2canvas-pro + addImage instead of `jsPDF.html()`:
 * `pdf.html()` routes through `pdf.context2d` which renders text as native
 * PDF text using Helvetica (Latin-1 only). Polish characters and any non-
 * Latin-1 UTF-8 come out garbled (multi-byte sequences misread as separate
 * Latin-1 codepoints). Embedding a Unicode TrueType font would solve it but
 * requires shipping a ~150 KB font asset. Manual raster pagination keeps the
 * pipeline simple and renders any character correctly because everything is
 * pixels — at the cost of selectable text in the output.
 *
 * Replaces the previous native-print approach (3 iterations) which never
 * worked on Android PWA — the platform print framework treated the iframe as
 * a viewport snapshot and ignored multi-page pagination.
 */
export async function exportNoteAsPdf(note: NoteDecrypted): Promise<void> {
  // Fresh Marked instance — don't inherit MarkdownPreview's custom image
  // renderer (which emits placeholders); we want real <img> in the PDF.
  // The list / task-list renderers ARE shared with Preview so checklist items
  // render with `task-list-item` markup (no double bullet next to the
  // checkbox, scoped checked-state strikethrough).
  const printMarked = new Marked({ gfm: true, breaks: true });
  const { renderer } = createMarkdownListRenderers();
  printMarked.use({ renderer });
  const rawHtml = printMarked.parse(note.content ?? '', { async: false }) as string;
  const safeBodyHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });

  const filename = sanitizeFilename(note.title);

  // html2canvas-pro reads layout from a real, laid-out element. Off-screen via
  // `left: -10000px; top: 0` rather than huge negative top — the latter put
  // the element 100000px below the viewport's natural origin and confused
  // pagination. `top: 0` keeps the element at the document top in absolute
  // coordinates, just shifted horizontally out of view.
  const container = document.createElement('div');
  container.className = 'reborn-pdf-root';
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = [
    'position:absolute',
    'left:-10000px',
    'top:0',
    'width:800px',
    'pointer-events:none',
    'z-index:-1'
  ].join(';');

  const styleEl = document.createElement('style');
  styleEl.textContent = PDF_STYLES;
  container.appendChild(styleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'reborn-pdf-body';
  bodyEl.innerHTML = safeBodyHtml;
  container.appendChild(bodyEl);

  document.body.appendChild(container);

  try {
    // Collect candidate page-break boundaries in container-local CSS pixels.
    // Measured BEFORE html2canvas runs because html2canvas removes its
    // overlay clone after rendering — the source container is unaffected.
    const renderScale = 2;
    const containerTop = container.getBoundingClientRect().top;
    const breakBoundariesCss: number[] = [];
    const collect = (el: Element) => {
      const bottom = el.getBoundingClientRect().bottom - containerTop;
      if (bottom > 0) breakBoundariesCss.push(bottom);
    };
    // Top-level body blocks (h1-h6, p, ul, ol, table, pre, blockquote, hr,
    // figure, …). Each is a natural break point.
    for (const child of Array.from(bodyEl.children)) collect(child);
    // Every list item, at ANY nesting depth, is also a friendly break point
    // (breaking between <li> beats slicing through a bullet glyph). Recursing
    // the WHOLE list tree - not just one level - is what fixes a generated TOC:
    // when the note has a single top-level heading, every entry nests under one
    // giant top-level <li> that offers no interior boundary. The largest break
    // that still fits on page one is then the block BEFORE the list (the bold
    // TOC title), stranding the whole TOC on page two behind a near-blank page.
    for (const li of Array.from(bodyEl.querySelectorAll('li'))) collect(li);
    breakBoundariesCss.sort((a, b) => a - b);

    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas-pro')
    ]);

    const fullCanvas = await html2canvas(container, {
      scale: renderScale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageWidthPt = pdf.internal.pageSize.getWidth(); // 595
    const pageHeightPt = pdf.internal.pageSize.getHeight(); // 842
    const marginPt = 40;
    const contentWidthPt = pageWidthPt - 2 * marginPt; // 515
    const contentHeightPt = pageHeightPt - 2 * marginPt; // 762

    // Source canvas: `fullCanvas.width × fullCanvas.height` pixels. We map it
    // onto the PDF so its width spans `contentWidthPt`. `pxPerPt` is how many
    // source-pixel rows correspond to one PDF point.
    const pxPerPt = fullCanvas.width / contentWidthPt;
    const idealSliceHeightPx = Math.floor(contentHeightPt * pxPerPt);
    // Convert CSS-pixel boundaries to canvas-pixel coordinates.
    const boundariesPx = breakBoundariesCss.map((b) =>
      Math.round(b * renderScale)
    );

    // Compute page slices by walking boundaries: for each page, prefer the
    // largest block-bottom boundary that fits within the ideal slice; if none
    // is available (e.g., a single block taller than a page), fall back to the
    // hard pixel cut so we don't loop forever.
    const slices: { startY: number; endY: number }[] = [];
    let pageStartY = 0;
    while (pageStartY < fullCanvas.height) {
      const idealEnd = Math.min(
        pageStartY + idealSliceHeightPx,
        fullCanvas.height
      );
      if (idealEnd === fullCanvas.height) {
        slices.push({ startY: pageStartY, endY: fullCanvas.height });
        break;
      }
      // Largest boundary in (pageStartY, idealEnd]
      let chosen = -1;
      for (const b of boundariesPx) {
        if (b > pageStartY && b <= idealEnd && b > chosen) chosen = b;
        else if (b > idealEnd) break; // sorted ascending
      }
      const endY = chosen > pageStartY ? chosen : idealEnd;
      slices.push({ startY: pageStartY, endY });
      pageStartY = endY;
    }

    const sliceCanvas = document.createElement('canvas');
    const sliceCtx = sliceCanvas.getContext('2d');
    if (!sliceCtx) throw new Error('Failed to acquire 2d context for PDF slice');

    for (let i = 0; i < slices.length; i++) {
      if (i > 0) pdf.addPage();
      const { startY, endY } = slices[i];
      const sliceHeightPx = endY - startY;
      const sliceHeightPt = sliceHeightPx / pxPerPt;

      sliceCanvas.width = fullCanvas.width;
      sliceCanvas.height = sliceHeightPx;
      // White background — JPEG has no alpha; transparent pixels would
      // otherwise encode as black.
      sliceCtx.fillStyle = '#ffffff';
      sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      sliceCtx.drawImage(
        fullCanvas,
        0,
        startY,
        fullCanvas.width,
        sliceHeightPx,
        0,
        0,
        fullCanvas.width,
        sliceHeightPx
      );

      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(
        sliceData,
        'JPEG',
        marginPt,
        marginPt,
        contentWidthPt,
        sliceHeightPt
      );
    }

    if (__REBORN_NATIVE__) {
      // jspdf's save() uses the same silently-ignored anchor download under
      // WKWebView - route the bytes through the shared native export path.
      await downloadBlob(pdf.output('blob'), `${filename}.pdf`);
    } else {
      pdf.save(`${filename}.pdf`);
    }
  } catch (e) {
    logger.error('PDF export failed', e);
    throw e;
  } finally {
    container.remove();
    // html2canvas-pro appends `<iframe class="html2canvas-container">` to body
    // for its DOM clone. On success it cleans up; on a thrown error mid-render
    // the iframe can be left behind — drop it so the page isn't holding a
    // hidden, off-screen frame in memory.
    document
      .querySelectorAll('iframe.html2canvas-container')
      .forEach((el) => el.remove());
  }
}

/** Export multiple notes as a .zip archive (JSZip, dynamically imported). */
export async function exportNotesAsZip(
  notes: NoteDecrypted[],
  folderTree: FolderWithChildren[],
  archiveName = 'reborn-notes-export'
): Promise<void> {
  // Resolve tag names for all notes in bulk
  const allTags = await tagStore.getAll();
  const allNoteTagRelations = await noteTagStore.getAll();
  // Decrypt tag names — tags are stored encrypted in IndexedDB
  const tagNameById = new Map<string, string>();
  if (cryptoManager.isInitialized()) {
    for (const t of allTags) {
      try {
        const name = await cryptoManager.decryptText(t.name_encrypted);
        tagNameById.set(t.id, name);
      } catch {
        tagNameById.set(t.id, t.name_encrypted);
      }
    }
  }
  const tagsByNote = new Map<string, string[]>();
  for (const rel of allNoteTagRelations) {
    const arr = tagsByNote.get(rel.note_id) ?? [];
    const name = tagNameById.get(rel.tag_id);
    if (name) arr.push(name);
    tagsByNote.set(rel.note_id, arr);
  }

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folderPaths = buildFolderPathMap(folderTree);
  const usedPaths = new Set<string>();

  for (const note of notes) {
    const tagNames = tagsByNote.get(note.id) ?? [];
    const content = buildMarkdownContent(note, tagNames);
    const dir = note.folder_id ? (folderPaths.get(note.folder_id) ?? '') : '';
    const base = sanitizeFilename(note.title);
    let filePath = dir ? `${dir}/${base}.md` : `${base}.md`;

    // Deduplicate filenames within the same directory
    let counter = 1;
    while (usedPaths.has(filePath)) {
      filePath = dir ? `${dir}/${base}_${counter}.md` : `${base}_${counter}.md`;
      counter++;
    }
    usedPaths.add(filePath);
    zip.file(filePath, content);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await downloadBlob(blob, `${archiveName}.zip`);
}

/**
 * Strip local-only shadow indexes from a note before persisting to a file.
 *
 * Zero Knowledge: `is_pinned` and `is_starred` live ONLY locally; their
 * authoritative copy is inside `metadata_encrypted`. They are rebuilt on
 * import. `is_archived` is operational (server-aware) and stays plain.
 * Note-tag relations are also encoded inside `metadata_encrypted.tags`.
 */
function stripNoteShadowIndexes(note: NoteStoredLocal): NoteEncrypted {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { is_pinned, is_starred, ...rest } = note;
  return rest;
}

/**
 * Sanitize records before serializing to a backup file:
 *  1. Repair corrupted UUIDs (legacy IDB data with stripped leading zeros).
 *  2. Convert `null` → `undefined` for optional-but-not-nullable fields so
 *     `JSON.stringify` drops them. Without this step, legacy IDB records that
 *     stored e.g. `folder_id: null` would emit `"folder_id": null` in the file,
 *     and a later import (or a third-party importer) might reject the value
 *     because the schema expects `string | undefined`. See guideline 44.
 *  3. Stamp the current account's UUID into `user_id` when the stored value
 *     is null/missing/non-UUID. The local IDB cleanup migration repairs the
 *     same pollution, but this is a belt-and-suspenders pass — without it,
 *     a backup taken before the next boot's cleanup would still emit
 *     `"user_id": null`.
 */
function normalizeExportUuids<T extends { id: string }>(
  items: T[],
  uuidFields: string[],
  optionalFields: readonly string[] = [],
  userIdReplacement?: string
): T[] {
  return items.map((item) => {
    let modified = false;
    const copy = { ...item } as Record<string, unknown>;
    for (const field of uuidFields) {
      const val = copy[field];
      if (typeof val === 'string' && !UUID_RE.test(val)) {
        const repaired = tryFixUuid(val);
        if (repaired) {
          copy[field] = repaired;
          modified = true;
        }
      }
    }
    for (const field of optionalFields) {
      if (copy[field] === null) {
        copy[field] = undefined;
        modified = true;
      }
    }
    if (userIdReplacement && UUID_RE.test(userIdReplacement)) {
      const stored = copy.user_id;
      if (typeof stored !== 'string' || !UUID_RE.test(stored)) {
        copy.user_id = userIdReplacement;
        modified = true;
      }
    }
    if (modified) {
      logger.warn(`Export: znormalizowano dane elementu ${copy.id as string}`);
    }
    return copy as T;
  });
}

/**
 * Export a full JSON backup of all note-related data from IndexedDB.
 *
 * Zero Knowledge: shadow indexes (is_pinned, is_starred) are stripped from
 * notes; they will be rebuilt from `metadata_encrypted` on import.
 * Note-tag relations are NOT included — they are encoded inside each note's
 * `metadata_encrypted.tags` and rebuilt on import.
 */
export async function exportJsonBackup(): Promise<void> {
  const [notes, folders, tags] = await Promise.all([
    noteStore.getAll() as Promise<NoteStoredLocal[]>,
    folderStore.getAll(),
    tagStore.getAll()
  ]);

  const userId = get(authStore).userId ?? undefined;

  const sanitizedNotes: NoteEncrypted[] = normalizeExportUuids(
    notes.map(stripNoteShadowIndexes),
    ['id', 'user_id', 'folder_id'],
    NOTE_OPTIONAL_FIELDS,
    userId
  );
  const sanitizedFolders = normalizeExportUuids(
    folders,
    ['id', 'user_id', 'parent_id'],
    FOLDER_OPTIONAL_FIELDS,
    userId
  );
  const sanitizedTags = normalizeExportUuids(tags, ['id', 'user_id'], TAG_OPTIONAL_FIELDS, userId);

  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    app: 'reborn-notes',
    data: { notes: sanitizedNotes, folders: sanitizedFolders, tags: sanitizedTags }
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json; charset=utf-8' });
  const date = new Date().toISOString().slice(0, 10);
  await downloadBlob(blob, `reborn-notes-backup-${date}.json`);
}

// ── Portable backup (envelope v3, "plaintext-inside") ────────────────────────

/**
 * Build a portable, password-encrypted backup (envelope v3) WITHOUT writing it
 * anywhere - returns the JSON blob plus entity counts. This is the download-free
 * seam shared by the manual export ({@link exportEncryptedBackup}) and the
 * automated backup engine, which writes the bytes to the user's chosen folder
 * instead of triggering a browser download.
 *
 * See {@link exportEncryptedBackup} for the Zero Knowledge rationale.
 */
export async function buildEncryptedBackup(
  password: string
): Promise<{ blob: Blob; counts: { notes: number; folders: number; tags: number } }> {
  if (!cryptoManager.isInitialized()) {
    throw new Error('Brak załadowanego klucza szyfrowania - odblokuj konto i spróbuj ponownie.');
  }

  const [notes, folders, tags] = await Promise.all([
    noteStore.getAll() as Promise<NoteStoredLocal[]>,
    folderStore.getAll() as Promise<FolderEncrypted[]>,
    tagStore.getAll() as Promise<TagEncrypted[]>
  ]);

  const payload = await buildPortablePayload(
    cryptoManager,
    notes,
    folders,
    tags,
    new Date().toISOString()
  );

  const { salt, iv, data } = await encryptWithPassword(JSON.stringify(payload), password);
  const envelope: BackupV3 = {
    version: 3,
    encryption: 'aes-256-gcm-pbkdf2',
    payload: 'plaintext',
    salt,
    iv,
    data
  };

  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/json; charset=utf-8'
  });
  return {
    blob,
    counts: {
      notes: payload.data.notes.length,
      folders: payload.data.folders.length,
      tags: payload.data.tags.length
    }
  };
}

/**
 * Export a portable, password-encrypted backup (envelope version 3).
 *
 * Unlike version 2 - which wrapped account-key ciphertext in a password layer
 * and was therefore readable only on the originating account - version 3 stores
 * the notes/folders/tags DECRYPTED inside the password-protected envelope. On
 * import the payload is re-encrypted with the importing account's master key,
 * so the backup is genuinely portable across accounts (a superset of the
 * Markdown export: full fidelity + portability).
 *
 * Zero Knowledge is preserved end to end: decryption (here) and re-encryption
 * (on import) both run in the browser. The only artifact that leaves is the
 * password-encrypted envelope; the server never sees plaintext and its
 * visibility is unchanged.
 */
export async function exportEncryptedBackup(password: string): Promise<void> {
  const { blob } = await buildEncryptedBackup(password);
  const date = new Date().toISOString().slice(0, 10);
  await downloadBlob(blob, `reborn-notes-backup-portable-${date}.json`);
}

// ── Backup format detection & types ──────────────────────────────────────────

type BackupV1 = {
  version: 1;
  data: {
    notes: Record<string, unknown>[];
    folders: Record<string, unknown>[];
    tags: Record<string, unknown>[];
    /**
     * Legacy field — pre-fix backups dumped raw note-tag relations.
     * Current backups encode tag IDs inside `metadata_encrypted.tags` and
     * omit this field. Kept optional for backwards compat with old files.
     */
    noteTags?: Record<string, unknown>[];
  };
};

type BackupV2 = {
  version: 2;
  encryption: string;
  salt: string;
  iv: string;
  data: string;
};

/**
 * Portable encrypted envelope (version 3). Same password-derived AES-GCM
 * wrapper as v2, but `data` decrypts to a {@link PortablePayload} of plaintext
 * (`payload: 'plaintext'`) instead of account-key ciphertext - which is what
 * makes it importable on any account. See {@link exportEncryptedBackup}.
 */
type BackupV3 = {
  version: 3;
  encryption: string;
  payload: 'plaintext';
  salt: string;
  iv: string;
  data: string;
};

export type ImportBackupResult = {
  notes: number;
  folders: number;
  tags: number;
  noteTags: number;
  skipped: number;
  /**
   * Number of folders/notes whose local copy was archived (in trash) but
   * the backup version was active — the timestamp guard was overridden so
   * the backup wins. Subset of `folders` + `notes`: each restored item is
   * also counted in its main bucket (the import did happen). UI surfaces
   * this separately so the user knows the backup just resurrected items
   * they had moved to trash.
   */
  restoredFromTrash: number;
  /**
   * Number of notes whose local `folder_id` was re-linked back to the
   * backup's folder while preserving the local title/content/metadata
   * (the local note was newer by timestamp because `deleteFolder`
   * rewrites `folder_id = null` on every child, bumping `updated_at`,
   * but the user's actual content edits — if any — outrank the backup's
   * stale snapshot). NOT a subset of `notes`: a relinked note isn't a
   * full backup import, just a structural fix on the local copy.
   */
  relinkedToFolder: number;
  /**
   * Total number of unsafe markdown elements removed from imported notes
   * (base64 data URIs, dangerous HTML tags, javascript:/data:text/html links).
   * Mirrors the counter from {@link importMarkdownFiles} / {@link importFolder}
   * so older backups created before content sanitization existed are scrubbed
   * on import — defense in depth, even though account-key-encrypted content
   * is only readable on the originating account.
   */
  strippedCount: number;
  errors: string[];
};

/**
 * Check if a backup file is password-encrypted (version 2 legacy same-account,
 * or version 3 portable). Call this before importJsonBackup to know whether a
 * password prompt is needed.
 */
export function isEncryptedBackup(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return (
      (parsed.version === 2 || parsed.version === 3) && typeof parsed.encryption === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Check if a backup file is a portable (version 3) backup: a plaintext payload
 * inside a password envelope, re-encrypted with the current account key on
 * import so it lands on ANY account. Unlike the same-account formats (v1/v2),
 * a portable import regenerates every id, so re-importing the same file ADDS
 * fresh copies rather than updating in place. The UI uses this to warn that a
 * repeated import duplicates the data.
 */
export function isPortableBackup(raw: string): boolean {
  try {
    return JSON.parse(raw).version === 3;
  } catch {
    return false;
  }
}

/**
 * Import a JSON backup file:
 *  - version 1: plaintext envelope, account-key ciphertext inside (same account).
 *  - version 2: password envelope, account-key ciphertext inside (legacy, same
 *    account only - kept for back-compat).
 *  - version 3: password envelope, plaintext inside - re-encrypted with the
 *    current account key, so it imports on ANY account.
 *
 * - Validates each item with Zod schemas before saving.
 * - Uses timestamp-based conflict resolution: skips items where the local version is newer.
 * - Forces sync_status='pending' and triggers pushPendingItems() after import.
 */
export async function importJsonBackup(
  raw: string,
  password?: string,
  onProgress?: ImportProgressCallback
): Promise<ImportBackupResult> {
  // raw is already in memory (file.text() in UI), but guard against absurd sizes
  if (raw.length > MAX_IMPORT_FILE_SIZE) {
    throw new Error(`Plik backupu (${Math.round(raw.length / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB.`);
  }

  const userId = get(authStore).userId;
  if (!userId) {
    throw new Error('Użytkownik nie jest zalogowany.');
  }

  const parsed = JSON.parse(raw);
  let backupData: BackupV1['data'];

  if (parsed.version === 2 || parsed.version === 3) {
    // Password-encrypted envelope. Both versions share the same PBKDF2 +
    // AES-GCM wrapper; they differ only in what the ciphertext decrypts to.
    // Phrase-tolerant decrypt: an auto-backup is keyed by the recovery phrase,
    // which the restoring user re-types from paper - the helper retries with
    // the normalized phrase form when the raw input fails (audit 012 N4).
    if (!password) throw new Error('Ten backup jest zaszyfrowany. Podaj hasło.');
    const envelope = parsed as BackupV2 | BackupV3;
    let decrypted: string;
    try {
      decrypted = await decryptWithPasswordOrPhrase(
        { salt: envelope.salt, iv: envelope.iv, data: envelope.data },
        password
      );
    } catch {
      throw new Error('Nieprawidłowe hasło lub uszkodzony plik backupu.');
    }
    const inner = JSON.parse(decrypted);
    if (parsed.version === 3) {
      // Plaintext payload - re-encrypt with the current account key so the
      // shared loops below handle it like any other backup. Portable: lands
      // readable on any account.
      if (!cryptoManager.isInitialized()) {
        throw new Error(
          'Brak załadowanego klucza szyfrowania - odblokuj konto i spróbuj ponownie.'
        );
      }
      backupData = await reencryptPortablePayload(cryptoManager, inner as PortablePayload, userId);
    } else {
      // v2: inner.data is account-key ciphertext. Decryptable only on the
      // originating account (legacy same-account-only behavior).
      backupData = inner.data;
    }
  } else if (parsed.version === 1) {
    // Plaintext envelope, account-key ciphertext inside.
    backupData = (parsed as BackupV1).data;
  } else {
    throw new Error('Nieznany format backupu.');
  }

  // Account-key formats (v1/v2) are readable only on the account that created
  // them: on any other account every field fails the AES-GCM auth check, so
  // the loops below would import unreadable rows (blank titles, default shadow
  // indexes) that then bounce off the server's ownership guard on every push.
  // Probe one ciphertext per entity kind and stop with a clear message
  // pointing at the portable (password) backup - the supported cross-account
  // path. v3 never gets here unreadable (its payload was just re-encrypted
  // with the current key), and without a loaded key we keep the legacy
  // behavior of importing ciphertext as-is for a later same-account unlock.
  // Mirrors the Task guard from #338 (audit 012 S3).
  if (parsed.version !== 3 && cryptoManager.isInitialized()) {
    const probeField = (row: Record<string, unknown> | undefined, field: string) => {
      const value = row?.[field];
      return typeof value === 'string' ? value : undefined;
    };
    const readable = await isEncryptedDataReadable(
      [
        probeField(backupData.folders?.[0], 'name_encrypted'),
        probeField(backupData.notes?.[0], 'title_encrypted'),
        probeField(backupData.tags?.[0], 'name_encrypted')
      ],
      (ciphertext) => cryptoManager.decryptText(ciphertext)
    );
    if (!readable) {
      // Dynamic import: the i18n store runs browser-only setup at module scope,
      // which would break the node-side specs that import this service.
      const { t } = await import('$lib/stores/i18n.store');
      throw new Error(get(t)('settings_page.export_import.import_cross_account_error'));
    }
  }

  const now = new Date().toISOString();
  const result: ImportBackupResult = {
    notes: 0, folders: 0, tags: 0, noteTags: 0, skipped: 0,
    restoredFromTrash: 0, relinkedToFolder: 0, strippedCount: 0, errors: []
  };

  // Folders that were either restored from local trash or freshly created
  // by this import. The note loop uses this to decide whether a backup's
  // `folder_id` for a note can safely override the local `folder_id`
  // without overwriting a deliberate user move. See {@link shouldRelinkToBackupFolder}.
  const restoredOrCreatedFolderIds = new Set<string>();

  // Import folders first (notes reference them)
  for (const folder of backupData.folders ?? []) {
    try {
      const normalized = normalizeNullToUndefined(
        folder as Record<string, unknown>,
        FOLDER_OPTIONAL_FIELDS
      );
      // The current account is authoritative for `user_id`; the value carried
      // in the file is irrelevant (we overwrite it on save anyway). Set it
      // before validation so legacy backups with null/missing/invalid user_id
      // — produced by older client builds or by a sync pull racing auth
      // restoration — don't fail Zod's `z.string().uuid()` check. Same
      // behavior on cross-account imports: ownership transfers to the
      // importing user. See guideline 44.
      normalized.user_id = userId;
      const { fixed: fixedFolder, repairedFields: repairedFolderFields } = fixEntityUuids(
        normalized,
        ['id', 'user_id', 'parent_id']
      );
      if (repairedFolderFields.length > 0) {
        logger.warn(`Folder ${fixedFolder.id}: naprawiono UUID w polach: ${repairedFolderFields.join(', ')}`);
      }
      const parsed = schemas.FolderEncryptedSchema.safeParse(fixedFolder);
      if (!parsed.success) {
        result.errors.push(`Folder ${fixedFolder.id}: walidacja nie powiodła się — ${formatZodIssues(parsed.error)}`);
        continue;
      }
      const validated = parsed.data;
      const existing = await folderStore.get(validated.id);
      // Backup is authoritative for `is_archived`: if the folder is in the
      // local trash but the backup has it active, override the timestamp
      // guard and restore it (updated_at = now, so other devices pick up
      // the restoration on next sync).
      const restoring = shouldRestoreFromTrash(existing, validated);
      if (existing && existing.updated_at >= validated.updated_at && !restoring) {
        result.skipped++;
        continue;
      }
      const toSave = {
        ...validated,
        parent_id: validated.parent_id ?? undefined,
        user_id: userId,
        sync_status: 'pending' as const,
        sync_version: 0,
        updated_at: now
      };
      await folderStore.save(toSave);
      // Push is deferred to pushPendingItems() at the end of the import.
      // Firing per-element pushes here would race against the parallel note
      // pushes below — the server's POST /api/notes FK-checks folder_id
      // and 404s when a note's parent folder hasn't landed yet. The end-of-
      // import pushPendingItems() runs `Promise.allSettled([folders + tags])
      // → Promise.allSettled(notes)` so the FK relationship is satisfied
      // before any note POST fires. See guideline 44 + the regression test
      // "importJsonBackup defers all pushes to pushPendingItems".
      result.folders++;
      restoredOrCreatedFolderIds.add(validated.id);
      if (restoring) result.restoredFromTrash++;
    } catch (e: unknown) {
      result.errors.push(`Folder ${folder.id}: ${e instanceof Error ? e.message : 'błąd'}`);
    }
  }

  // Import tags
  for (const tag of backupData.tags ?? []) {
    try {
      const normalized = normalizeNullToUndefined(
        tag as Record<string, unknown>,
        TAG_OPTIONAL_FIELDS
      );
      // user_id from file is ignored — set authoritative value before
      // validation. See folder loop above for rationale.
      normalized.user_id = userId;
      const { fixed: fixedTag, repairedFields: repairedTagFields } = fixEntityUuids(
        normalized,
        ['id', 'user_id']
      );
      if (repairedTagFields.length > 0) {
        logger.warn(`Tag ${fixedTag.id}: naprawiono UUID w polach: ${repairedTagFields.join(', ')}`);
      }
      const parsed = schemas.TagEncryptedSchema.safeParse(fixedTag);
      if (!parsed.success) {
        result.errors.push(`Tag ${fixedTag.id}: walidacja nie powiodła się — ${formatZodIssues(parsed.error)}`);
        continue;
      }
      const validated = parsed.data;
      const existing = await tagStore.get(validated.id);
      if (existing && existing.updated_at >= validated.updated_at) {
        result.skipped++;
        continue;
      }
      const toSave = {
        ...validated,
        user_id: userId,
        sync_status: 'pending' as const,
        sync_version: 0,
        updated_at: now
      };
      await tagStore.save(toSave);
      // Push deferred to pushPendingItems() — see folder loop above.
      result.tags++;
    } catch (e: unknown) {
      result.errors.push(`Tag ${tag.id}: ${e instanceof Error ? e.message : 'błąd'}`);
    }
  }

  // Import notes — strip any shadow indexes a legacy file may have, then
  // rebuild them locally from `metadata_encrypted` (Zero Knowledge: shadow
  // indexes are NEVER trusted from a file).
  // Notes dominate import time (decrypt + sanitize + re-encrypt per note),
  // so progress is reported only for this loop. Folders/tags above are
  // typically a handful of items and complete in under a frame.
  const notes = backupData.notes ?? [];
  const totalNotes = notes.length;
  onProgress?.({ phase: 'reading', current: 0, total: totalNotes });
  let lastEmit = 0;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    try {
      // Strip shadow indexes from raw input before validation. Zod's safeParse
      // strips unknowns, so this is mostly defensive — it makes the intent
      // explicit and tolerates legacy files.
      const wireCandidate = stripUnknownNoteShadowIndexes(note) as Record<string, unknown>;
      const normalized = normalizeNullToUndefined(wireCandidate, NOTE_OPTIONAL_FIELDS);
      // user_id from file is ignored — set authoritative value before
      // validation. See folder loop above for rationale.
      normalized.user_id = userId;
      const { fixed: fixedNote, repairedFields: repairedNoteFields } = fixEntityUuids(
        normalized,
        ['id', 'user_id', 'folder_id']
      );
      if (repairedNoteFields.length > 0) {
        logger.warn(`Note ${fixedNote.id}: naprawiono UUID w polach: ${repairedNoteFields.join(', ')}`);
      }
      const parsed = schemas.NoteEncryptedSchema.safeParse(fixedNote);
      if (!parsed.success) {
        result.errors.push(`Note ${(fixedNote as { id?: string }).id ?? '?'}: walidacja nie powiodła się — ${formatZodIssues(parsed.error)}`);
        continue;
      }
      const validated = parsed.data;
      const existing = await noteStore.get(validated.id);
      // Backup is authoritative for `is_archived`: if the note is in the
      // local trash but the backup has it active (or omits the field —
      // the schema treats it as optional), override the timestamp guard
      // and restore it. updated_at is set to now below so the restoration
      // propagates to other devices.
      const restoring = shouldRestoreFromTrash(existing, validated);
      // Relink-to-backup-folder: local note is "newer" only because
      // deleteFolder rewrote folder_id=null, but the backup remembers the
      // original folder which is being restored/created in this same
      // import. Preserve local content edits, just put the note back where
      // the backup says it belongs.
      const relinking =
        !restoring &&
        shouldRelinkToBackupFolder(existing, validated, restoredOrCreatedFolderIds);
      if (
        existing &&
        existing.updated_at >= validated.updated_at &&
        !restoring &&
        !relinking
      ) {
        result.skipped++;
        continue;
      }

      if (relinking && existing) {
        // Keep local title/content/metadata/shadow indexes as-is; only
        // override folder_id and bump sync metadata so the move propagates.
        const toSave: NoteStoredLocal = {
          ...existing,
          folder_id: validated.folder_id ?? undefined,
          sync_status: 'pending',
          sync_version: 0,
          updated_at: now
        };
        await noteStore.save(toSave);
        // Push deferred to pushPendingItems() — see folder loop above.
        result.relinkedToFolder++;
        continue;
      }

      // Rebuild shadow indexes + tag list from metadata_encrypted (mirrors pullNotes()).
      let is_pinned = false;
      let is_starred = false;
      let metaTagIds: string[] = [];
      try {
        if (validated.metadata_encrypted && cryptoManager.isInitialized()) {
          const meta = await cryptoManager.decryptObject<NoteSensitiveMetadata>(
            validated.metadata_encrypted
          );
          is_pinned = meta.is_pinned ?? false;
          is_starred = meta.is_starred ?? false;
          metaTagIds = meta.tags ?? [];
        }
      } catch (decryptErr) {
        logger.error(
          `METADATA_DECRYPT_FAILED for imported note ${validated.id} — shadow indexes will use defaults`,
          decryptErr
        );
      }

      // Defense in depth: scrub unsafe markdown (base64 data URIs, <script>,
      // javascript: links) from older backups. Mirrors the .md / folder import
      // path. Decrypts with the current account key, sanitizes plaintext, and
      // re-encrypts only when something was stripped — preserving Zero
      // Knowledge: ciphertext leaves the browser, plaintext never does. If
      // the content is encrypted with a different key (cross-account import)
      // decryption fails and we leave the ciphertext untouched.
      let sanitizedContentEncrypted: string | undefined;
      if (validated.content_encrypted && cryptoManager.isInitialized()) {
        try {
          const plaintext = await cryptoManager.decryptText(validated.content_encrypted);
          const { sanitized, stripped } = sanitizeMarkdownContent(plaintext);
          if (stripped.length > 0) {
            sanitizedContentEncrypted = await cryptoManager.encryptText(sanitized);
            result.strippedCount += stripped.length;
          }
        } catch (sanitizeErr) {
          logger.warn(
            `Could not sanitize content for imported note ${validated.id} — keeping ciphertext as-is`,
            sanitizeErr
          );
        }
      }

      const wire: NoteEncrypted = {
        ...validated,
        folder_id: validated.folder_id ?? undefined,
        ...(sanitizedContentEncrypted !== undefined
          ? { content_encrypted: sanitizedContentEncrypted }
          : {}),
        user_id: userId,
        sync_status: 'pending',
        sync_version: 0,
        updated_at: now
      };
      const toSave: NoteStoredLocal = {
        ...wire,
        is_pinned,
        is_starred
      };
      await noteStore.save(toSave);

      // Rebuild local note-tag associations from metadata_encrypted.tags
      // (mirrors pullNotes() — relations are not stored in the file directly).
      if (metaTagIds.length > 0) {
        const currentTagIds = await noteTagQueries.getTagsForNote(validated.id);
        const toAdd = metaTagIds.filter((id) => !currentTagIds.includes(id));
        const toRemove = currentTagIds.filter((id) => !metaTagIds.includes(id));
        await Promise.all([
          ...toAdd.map((tagId) =>
            noteTagOperations
              .addTagToNote(validated.id, tagId)
              .catch((e) => logger.warn('Failed to add tag to note', e))
          ),
          ...toRemove.map((tagId) =>
            noteTagOperations
              .removeTagFromNote(validated.id, tagId)
              .catch((e) => logger.warn('Failed to remove tag from note', e))
          )
        ]);
      }

      // Push deferred to pushPendingItems() — see folder loop above.
      result.notes++;
      if (restoring) result.restoredFromTrash++;
    } catch (e: unknown) {
      result.errors.push(`Note ${(note as { id?: string }).id ?? '?'}: ${e instanceof Error ? e.message : 'błąd'}`);
    }

    const current = i + 1;
    const nowMs = Date.now();
    if (current === totalNotes || nowMs - lastEmit >= 50) {
      onProgress?.({ phase: 'reading', current, total: totalNotes });
      lastEmit = nowMs;
    }
  }

  // Backwards compat: legacy v1 backups contained an explicit `noteTags`
  // array. We still honor it for old files, but new exports omit it because
  // tag IDs already live inside metadata_encrypted.tags.
  for (const rel of backupData.noteTags ?? []) {
    try {
      const parsed = schemas.NoteTagSchema.safeParse(rel);
      if (!parsed.success) {
        result.errors.push(`NoteTag: walidacja nie powiodła się — ${formatZodIssues(parsed.error)}`);
        continue;
      }
      const rawId = (rel as Record<string, unknown>).id;
      const id = typeof rawId === 'string' ? rawId : crypto.randomUUID();
      const noteTag: NoteTag = { ...parsed.data, id };
      await noteTagStore.save(noteTag);
      result.noteTags++;
    } catch (e: unknown) {
      result.errors.push(`NoteTag: ${e instanceof Error ? e.message : 'błąd'}`);
    }
  }

  // Rebuild in-memory note title index so imported notes are visible
  // immediately without requiring a reload.
  onProgress?.({ phase: 'indexing', current: 0, total: 1 });
  try {
    await noteIndex.rebuild();
  } catch (e: unknown) {
    logger.warn('Failed to rebuild note index after import', e);
  }
  onProgress?.({ phase: 'indexing', current: 1, total: 1 });

  // Push every imported entity through one ordered batch. pushPendingItems()
  // uses buildFolderLayers (BFS by parent depth) and runs
  //   Promise.allSettled([folders + tags]) → Promise.allSettled(notes)
  // so the server's POST /api/notes FK check on `folder_id` always sees the
  // parent folder by the time a note POST fires. Per-loop fire-and-forget
  // pushes raced against this — see fix(notes): import-push-ordering and
  // guideline 44.
  void pushPendingItems();

  logger.info('Import complete', {
    folders: result.folders,
    tags: result.tags,
    notes: result.notes,
    noteTags: result.noteTags,
    skipped: result.skipped,
    restoredFromTrash: result.restoredFromTrash,
    relinkedToFolder: result.relinkedToFolder,
    errors: result.errors.length
  });

  return result;
}

/**
 * Defensive strip — drops local-only shadow keys before Zod validation.
 * `safeParse` already strips unknowns, but doing it explicitly documents
 * the Zero Knowledge invariant: these fields must be rebuilt from
 * `metadata_encrypted`, never trusted from a file.
 */
function stripUnknownNoteShadowIndexes(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { is_pinned, is_starred, ...rest } = raw as Record<string, unknown>;
  return rest;
}

// ── Import ───────────────────────────────────────────────────────────────────

/**
 * Build a per-folder lookup of taken note titles from the in-memory NoteIndex.
 *
 * Triggers a rebuild if the index appears empty despite notes existing on disk
 * (defensive — the importer must not silently skip dedup against existing
 * notes when the index is stale at import time).
 */
async function buildTitleLookupFromIndex(): Promise<TitleLookup> {
  if (noteIndex.count === 0) {
    const stored = await noteStore.getAll();
    if (stored.length > 0) {
      try {
        await noteIndex.build();
      } catch (e: unknown) {
        logger.warn('Failed to build note index for import dedup; proceeding without it', e);
      }
    }
  }
  const lookup: TitleLookup = new Map();
  for (const entry of noteIndex.entries()) {
    rememberTitle(lookup, entry.folderId, entry.title, entry.id);
  }
  return lookup;
}

export type ImportMarkdownResult = {
  imported: number;
  duplicatesSkipped: number;
  duplicatesOverwritten: number;
  duplicatesRenamed: number;
  /**
   * `overwrite` strategy only: duplicates whose stored note already matches
   * the imported file exactly - no write, no sync push, no `updated_at` bump.
   * Makes repeated "re-import to refresh" runs cheap and idempotent.
   */
  duplicatesUnchanged: number;
  errors: string[];
  strippedCount: number;
};

/**
 * Progress phase reported by the importer to a UI callback.
 *
 * - `reading`  — iterating files (read text + decrypt + dedup + write).
 *                `current`/`total` count files in the import batch.
 * - `indexing` — rebuilding the in-memory title index after all writes.
 *                Single-step phase; `current === total === 1`.
 */
export type ImportProgress = {
  phase: 'reading' | 'indexing';
  current: number;
  total: number;
};

export type ImportProgressCallback = (p: ImportProgress) => void;

/**
 * Import notes from an array of .md File objects.
 *
 * `duplicateStrategy` controls behavior when a note with the same title
 * already exists in `folderId` (case-insensitive):
 *   - `skip`      — leave the existing note untouched
 *   - `overwrite` — replace title/content; preserve the existing note's id
 *                   and `created_at` (so backlinks survive)
 *   - `rename`    — append " (N)" to the imported title until free
 */
export async function importMarkdownFiles(
  files: File[],
  folderId?: string,
  duplicateStrategy: DuplicateStrategy = 'rename',
  onProgress?: ImportProgressCallback
): Promise<ImportMarkdownResult> {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_IMPORT_FILE_SIZE) {
    throw new Error(`Łączny rozmiar plików (${Math.round(totalSize / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB.`);
  }

  const result: ImportMarkdownResult = {
    imported: 0,
    duplicatesSkipped: 0,
    duplicatesOverwritten: 0,
    duplicatesRenamed: 0,
    duplicatesUnchanged: 0,
    errors: [],
    strippedCount: 0
  };

  const lookup = await buildTitleLookupFromIndex();

  const total = files.length;
  onProgress?.({ phase: 'reading', current: 0, total });
  // Throttle progress events to one per ~50ms so a 1000-file import doesn't
  // flood the renderer; always report the final count regardless.
  let lastEmit = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const raw = await file.text();
      const parsed = parseMarkdownFile(raw);
      const { title, content } = parsed;
      const { sanitized, stripped } = sanitizeMarkdownContent(content);
      result.strippedCount += stripped.length;
      const baseTitle = title ?? (file.name.replace(/\.md$/i, '') || 'Untitled');
      const { createdAt, modifiedAt } = pickImportTimestamps(parsed, file.lastModified);
      // tagIds: undefined - the flat .md import does not manage tags (no
      // frontmatter tag resolution), so overwrite must leave the existing
      // note's tags untouched rather than wiping them with an empty set.
      // Kept un-destructured: narrowing `noteId` to `string` in the final
      // branch relies on the discriminated union, and TS only tracks that
      // reliably through property access, not destructured locals.
      const dedup = await applyDuplicateStrategy({
        baseTitle,
        content: sanitized,
        folderId,
        tagIds: undefined,
        modifiedAt,
        createdAt,
        lookup,
        strategy: duplicateStrategy
      });
      if (dedup.outcome === 'skipped') {
        result.duplicatesSkipped++;
      } else if (dedup.outcome === 'unchanged') {
        result.duplicatesUnchanged++;
      } else {
        if (dedup.outcome === 'overwritten') result.duplicatesOverwritten++;
        else if (dedup.outcome === 'renamed') result.duplicatesRenamed++;
        result.imported++;
        // Push the freshly-saved note (skipSync was true on the storage write).
        const note = await noteStore.get(dedup.noteId);
        if (note) pushNote(note);
      }
    } catch (e: unknown) {
      result.errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    const current = i + 1;
    const now = Date.now();
    if (current === total || now - lastEmit >= 50) {
      onProgress?.({ phase: 'reading', current, total });
      lastEmit = now;
    }
  }

  // Rebuild the title index so any in-place overwrites / new notes are
  // visible immediately without requiring a reload.
  onProgress?.({ phase: 'indexing', current: 0, total: 1 });
  try {
    await noteIndex.rebuild();
  } catch (e: unknown) {
    logger.warn('Failed to rebuild note index after markdown import', e);
  }
  onProgress?.({ phase: 'indexing', current: 1, total: 1 });

  return result;
}

/**
 * Per-file outcome reported by {@link applyDuplicateStrategy}.
 *
 * `skipped` (existing note left alone by user choice) and `unchanged`
 * (overwrite requested, but the stored note already matches the file) do not
 * bump the imported counter; the others all produce a persisted note.
 * `noteId` is `undefined` for the non-writing outcomes - callers that
 * bulk-push on completion should iterate over the populated ids.
 */
type DuplicateOutcomeResult =
  | { outcome: 'created' | 'overwritten' | 'renamed'; noteId: string }
  // `skipped` and `unchanged` stay SEPARATE constituents (not merged into one
  // `'skipped' | 'unchanged'`): control-flow exclusion (`!==` in an else-chain)
  // only drops a constituent whose discriminant narrows to never, so a
  // multi-literal constituent would survive both negations and `noteId` would
  // stay `string | undefined` in the writing branch. `unchanged` carries the
  // matched note's id (the file IS linked to an existing note - live folder
  // sync records it to detect a later in-app deletion); `skipped` (user chose
  // "skip duplicates") writes nothing and links to nothing.
  | { outcome: 'skipped'; noteId: undefined }
  | { outcome: 'unchanged'; noteId: string };

/**
 * Apply the selected duplicate-handling strategy for a single file.
 *
 * Mutates `lookup` so subsequent files in the same batch see the just-created
 * / just-renamed entry and don't double-collide with it.
 *
 * `tagIds` is the list of tag ids resolved from frontmatter (already
 * find-or-created by the caller). For `overwrite`, `tagMode` decides whether
 * it REPLACES the existing note's tag set (frontmatter as source of truth)
 * or is MERGED into it (tags added in the app survive - see
 * {@link TagOverwriteMode}). `undefined` means the import path does not
 * manage tags at all (flat .md import): tags are then ignored both for the
 * unchanged-comparison and on overwrite (the existing note's tags survive).
 *
 * Stars / pins live in `metadata_encrypted`, which `updateNote` never
 * touches - they survive overwrite regardless of `tagMode`.
 */
/**
 * A duplicate-strategy decision made WITHOUT looking at content. `create` /
 * `rename` carry a freshly-minted UUID (passed to {@link NoteService.createNote}
 * via `options.id`); `overwrite` / `skip` carry the existing note's id.
 */
type ResolvedImportTarget =
  | { kind: 'create'; noteId: string; title: string }
  | { kind: 'rename'; noteId: string; title: string }
  | { kind: 'overwrite'; noteId: string; title: string }
  | { kind: 'skip'; noteId: string; title: string };

/**
 * Resolve which note an imported file maps to, WITHOUT touching its content.
 *
 * This is the identity half of the duplicate strategy: an existing note to
 * overwrite/skip, or a freshly-minted id for a brand-new (or renamed) note.
 * Splitting it from the write lets {@link importFolder} resolve every file's id
 * up-front and build a complete `relativePath → note id` map BEFORE any content
 * is written - the precondition for rewriting inter-note links, since a file can
 * link to another file imported later in the same batch.
 *
 * Mutates `lookup` exactly as the old single-pass did (claims the title slot for
 * new/renamed notes and for stale-index manifest matches), so resolving the
 * whole batch up-front yields the same dedup outcomes as resolving inline.
 */
async function resolveImportTarget(args: {
  baseTitle: string;
  folderId: string | undefined;
  lookup: TitleLookup;
  strategy: DuplicateStrategy;
  /**
   * Live folder sync only: the note id this file's path mapped to on the
   * previous run (from the persisted `path_note_ids` manifest). When it still
   * resolves to a live note it overrides the title lookup, so a file already
   * linked to a note updates THAT note even if this tab's in-memory title index
   * is stale - see {@link pickOverwriteTarget}. Undefined for manual / flat .md
   * imports, which stay on pure title matching.
   */
  manifestNoteId?: string;
}): Promise<ResolvedImportTarget> {
  const { baseTitle, folderId, lookup, strategy } = args;

  // The path→note manifest (folder sync) wins over the title lookup when it
  // points at a still-live note: the lookup comes from the per-tab in-memory
  // note index, which can be stale, and trusting it alone minted duplicate notes
  // on re-sync. getNote() returns null for missing/trashed notes, so a stale
  // manifest link falls through to title matching (which re-creates the note -
  // the mirror's "disk wins" rule).
  const manifestNote =
    args.manifestNoteId !== undefined ? await NoteService.getNote(args.manifestNoteId) : null;
  const existingId = pickOverwriteTarget(
    { noteId: args.manifestNoteId, live: manifestNote !== null },
    lookup,
    folderId,
    baseTitle
  );

  if (!existingId) {
    const noteId = crypto.randomUUID();
    rememberTitle(lookup, folderId, baseTitle, noteId);
    return { kind: 'create', noteId, title: baseTitle };
  }

  // A manifest match can resolve a note whose title was NOT in the lookup (the
  // stale-index case). Claim the (folder, title) slot now so a later same-titled
  // file in this batch dedupes against it. A title-lookup match already occupies
  // the slot - no-op.
  if (manifestNote !== null) {
    rememberTitle(lookup, folderId, baseTitle, existingId);
  }

  if (strategy === 'skip') return { kind: 'skip', noteId: existingId, title: baseTitle };
  if (strategy === 'overwrite') return { kind: 'overwrite', noteId: existingId, title: baseTitle };

  // strategy === 'rename'
  const takenLower = new Set<string>();
  const bucket = lookup.get(folderKey(folderId));
  if (bucket) for (const k of bucket.keys()) takenLower.add(k);
  const renamedTitle = computeRenamedTitle(baseTitle, takenLower);
  const noteId = crypto.randomUUID();
  rememberTitle(lookup, folderId, renamedTitle, noteId);
  return { kind: 'rename', noteId, title: renamedTitle };
}

/**
 * Write a note for a previously {@link resolveImportTarget | resolved} target.
 *
 * The content half of the duplicate strategy: creates the note (with the
 * pre-assigned id), overwrites an existing one (skipping the write entirely when
 * the stored note already matches - the `unchanged` outcome), or does nothing
 * (`skip`). `content` is the FINAL content to store: the folder importer applies
 * the inter-note link rewrite before calling this, so the unchanged comparison
 * sees exactly what will be persisted - which keeps re-imports idempotent.
 *
 * `tagIds === undefined` means the import path does not manage tags (flat .md
 * import): tags are then excluded from the comparison and left untouched on
 * overwrite. When provided, `tagMode` decides replace vs merge (see
 * {@link TagOverwriteMode}). Stars / pins live in `metadata_encrypted`, which
 * `updateNote` never touches - they survive overwrite regardless.
 */
async function writeResolvedNote(args: {
  target: ResolvedImportTarget;
  content: string;
  folderId: string | undefined;
  tagIds: string[] | undefined;
  tagMode?: TagOverwriteMode;
  createdAt: string | undefined;
  modifiedAt: string | undefined;
}): Promise<DuplicateOutcomeResult> {
  const { target, content, folderId, tagIds, createdAt, modifiedAt } = args;
  const tagMode = args.tagMode ?? 'replace';

  if (target.kind === 'create' || target.kind === 'rename') {
    await NoteService.createNote(target.title, content, folderId, {
      id: target.noteId,
      createdAt,
      updatedAt: modifiedAt ?? createdAt,
      skipSync: true
    });
    if (tagIds && tagIds.length > 0) {
      await TagService.setTagsForNote(target.noteId, tagIds, { skipSync: true });
    }
    return target.kind === 'create'
      ? { outcome: 'created', noteId: target.noteId }
      : { outcome: 'renamed', noteId: target.noteId };
  }

  if (target.kind === 'skip') {
    return { outcome: 'skipped', noteId: undefined };
  }

  // target.kind === 'overwrite'
  // Skip the write entirely when the stored note already matches - repeated
  // "re-import to refresh" runs stay cheap (no re-encrypt, no sync push) and
  // don't shuffle every note to the top of `updated_at` ordering. getNote()
  // returns null for trashed notes; resolveImportTarget never returns an
  // overwrite target pointing at one (both a stale manifest link and a title
  // lookup exclude trashed notes), so the guard is defensive.
  const existingNote = await NoteService.getNote(target.noteId);
  const existingTagIds =
    tagIds === undefined ? [] : await noteTagQueries.getTagsForNote(target.noteId);
  if (existingNote) {
    const unchanged = isImportUnchanged(
      { title: existingNote.title, content: existingNote.content, tagIds: existingTagIds },
      { title: target.title, content, tagIds },
      tagMode
    );
    if (unchanged) {
      return { outcome: 'unchanged', noteId: target.noteId };
    }
  }
  await NoteService.updateNote(target.noteId, target.title, content, {
    updatedAt: modifiedAt ?? new Date().toISOString(),
    skipSync: true
  });
  if (tagIds !== undefined) {
    // `replace`: frontmatter is the tag source of truth. `merge`: union - tags
    // added in the app survive. Skip the write when the final set already equals
    // the note's tags (setTagsForNote always rewrites the whole join set, so a
    // no-op call would still churn IDB + sync).
    const finalTagIds = tagMode === 'merge' ? mergeTagIds(existingTagIds, tagIds) : tagIds;
    if (!tagSetsEqual(existingTagIds, finalTagIds)) {
      await TagService.setTagsForNote(target.noteId, finalTagIds, { skipSync: true });
    }
  }
  return { outcome: 'overwritten', noteId: target.noteId };
}

/**
 * Apply the selected duplicate strategy for a single file in one pass: resolve
 * the target, then write. Used by the flat `.md` importer and by the folder
 * importer when inter-note link rewriting is OFF (the default). With rewriting
 * ON, {@link importFolder} calls {@link resolveImportTarget} for the whole batch
 * first, rewrites, then {@link writeResolvedNote} - see there.
 */
async function applyDuplicateStrategy(args: {
  baseTitle: string;
  content: string;
  folderId: string | undefined;
  tagIds: string[] | undefined;
  tagMode?: TagOverwriteMode;
  createdAt: string | undefined;
  modifiedAt: string | undefined;
  lookup: TitleLookup;
  strategy: DuplicateStrategy;
  manifestNoteId?: string;
}): Promise<DuplicateOutcomeResult> {
  const target = await resolveImportTarget({
    baseTitle: args.baseTitle,
    folderId: args.folderId,
    lookup: args.lookup,
    strategy: args.strategy,
    manifestNoteId: args.manifestNoteId
  });
  return writeResolvedNote({
    target,
    content: args.content,
    folderId: args.folderId,
    tagIds: args.tagIds,
    tagMode: args.tagMode,
    createdAt: args.createdAt,
    modifiedAt: args.modifiedAt
  });
}

// ── Folder Import (Obsidian-style vault) ────────────────────────────────────

/** Flat lookup entry for folder find-or-create logic. */
type FolderLookupEntry = { id: string; name: string; parent_id: string | undefined };

/** Flatten the decrypted folder tree into `{ id, name, parent_id }` entries. */
function flattenFolderTree(nodes: FolderWithChildren[]): FolderLookupEntry[] {
  const out: FolderLookupEntry[] = [];
  const walk = (ns: FolderWithChildren[]) => {
    for (const n of ns) {
      out.push({ id: n.id, name: n.name, parent_id: n.parent_id });
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Walk a path of folder segments and return the leaf folder id, creating
 * any missing intermediate folders. Matches existing folders case-insensitively
 * on (parent_id, name). Mutates `lookup` so subsequent calls in the same
 * batch can reuse folders created earlier in this import.
 *
 * `startParentId` anchors the walk under an existing folder instead of the
 * root level ("import folder here" from a folder's context menu). An empty
 * path resolves to the anchor itself.
 */
async function findOrCreateFolderByPath(
  pathSegments: string[],
  lookup: FolderLookupEntry[],
  counter: { count: number },
  startParentId?: string
): Promise<string | undefined> {
  if (pathSegments.length === 0) return startParentId;

  let parentId: string | undefined = startParentId;
  for (const segment of pathSegments) {
    const segmentLower = segment.toLowerCase();
    const existing = lookup.find(
      (f) => f.parent_id === parentId && f.name.toLowerCase() === segmentLower
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }
    // skipSync: folder import bulk-pushes everything via pushPendingItems()
    // at the end so folders are guaranteed on the server before notes that
    // reference them — otherwise the server's folder_id FK check returns 404.
    const newId = await FolderService.createFolder(segment, parentId, { skipSync: true });
    lookup.push({ id: newId, name: segment, parent_id: parentId });
    counter.count++;
    parentId = newId;
  }
  return parentId;
}

/**
 * Find an existing tag by name (case-insensitive) or create a new one.
 * Mutates `lookup` so repeated tags within a batch don't create duplicates.
 */
async function findOrCreateTagByName(
  tagName: string,
  lookup: Array<{ id: string; name: string }>,
  counter: { count: number }
): Promise<string> {
  const lower = tagName.toLowerCase();
  const existing = lookup.find((t) => t.name.toLowerCase() === lower);
  if (existing) return existing.id;
  // skipSync: see findOrCreateFolderByPath — bulk push at end of importFolder().
  const newId = await TagService.createTag(tagName, undefined, { skipSync: true });
  lookup.push({ id: newId, name: tagName });
  counter.count++;
  return newId;
}

export type ImportFolderResult = {
  imported: number;
  foldersCreated: number;
  tagsCreated: number;
  skippedNonMarkdown: number;
  skippedTooLarge: number;
  skippedHidden: number;
  duplicatesSkipped: number;
  duplicatesOverwritten: number;
  duplicatesRenamed: number;
  /** See {@link ImportMarkdownResult.duplicatesUnchanged}. */
  duplicatesUnchanged: number;
  strippedCount: number;
  errors: string[];
  /**
   * Per-input map of `relativePath` → id of the note it resolved to (created,
   * overwritten, renamed, or matched-unchanged). Skipped / errored files are
   * absent. Live folder sync persists this as its file↔note manifest so a
   * later in-app deletion of a still-on-disk file can be detected and the note
   * re-imported; other callers ignore it.
   */
  pathToNoteId: Record<string, string>;
  /**
   * Links between imported files rewritten to internal `note:UUID` links -
   * relative Markdown path links and Obsidian wikilinks combined. Always 0
   * unless `rewriteInterNoteLinks` is enabled (see {@link ImportFolderOptions}).
   */
  linksRewritten: number;
};

export type ImportFolderOptions = {
  /**
   * Recreate the selected directory itself as a folder (find-or-create by
   * name, case-insensitive) instead of importing only its contents. This is
   * what makes "import `reapps-docs`, edit locally, re-import to refresh"
   * land in the same `reapps-docs` folder every time.
   */
  keepRootFolder?: boolean;
  /**
   * Anchor the imported tree under an existing folder instead of the root
   * level ("import folder here" from a folder's context menu).
   */
  targetFolderId?: string;
  /**
   * `overwrite` strategy only: how frontmatter tags interact with the
   * existing note's tags. `merge` (UI default, hard-coded for live folder
   * sync) unions them so tags added in the app survive re-imports; `replace`
   * (API default, pre-2026-06-13 behavior) makes frontmatter the source of
   * truth. See {@link TagOverwriteMode}.
   */
  tagsOnOverwrite?: TagOverwriteMode;
  /**
   * Live folder sync only: the previous run's durable `relativePath → note id`
   * manifest (persisted as `path_note_ids`). Lets the importer overwrite the
   * note a file is already linked to even when this tab's in-memory title index
   * is stale - the fix for duplicate notes on re-sync (see
   * {@link pickOverwriteTarget}). Absent for manual folder imports, which stay
   * on pure title-based dedup.
   */
  pathManifest?: Record<string, string>;
  /**
   * Rewrite links between imported files into reborn-notes internal note links
   * (`[x](note:UUID)`) so they navigate inside the app. Covers both relative
   * Markdown path links (`[x](../b.md)`) and Obsidian wikilinks (`[[Note]]`,
   * `[[Note|alias]]`, with `#heading`/`^block` subpaths dropped). Opt-in
   * (default OFF). Requires the two-phase import: every file's target id is
   * resolved up-front (so a file can link to one imported later in the same
   * batch), the rewrite is applied to each file's content BEFORE the
   * unchanged-comparison (keeping re-imports idempotent), then the notes are
   * written. Targets that don't resolve to an imported note (and, for bare
   * wikilinks, ambiguous basenames), images, `![[embeds]]`, external / anchor
   * links, and code spans are left untouched. See {@link rewriteInterNoteLinks}
   * and {@link buildWikilinkIndex}.
   */
  rewriteInterNoteLinks?: boolean;
};

/**
 * A file accepted by {@link importFolder}: either a plain `File` from a
 * `webkitdirectory` input (path read from `webkitRelativePath`) or a
 * `{ file, relativePath }` pair for sources where the browser does not stamp
 * a path on the File object - e.g. files collected from a File System Access
 * API directory handle by the live folder sync (`folder-sync.service.ts`).
 * `relativePath` uses the same shape as `webkitRelativePath`:
 * `<rootDir>/<sub>/<name.md>`, `/`-separated.
 */
export type ImportFolderInput = File | { file: File; relativePath: string };

/**
 * Import a folder tree of Markdown files (Obsidian-style vault).
 *
 * Reproduces the directory hierarchy as reborn-notes folders, imports every
 * `.md` file as a note, and rebuilds tags from `tags:` frontmatter. Files
 * that exceed {@link MAX_NOTE_CONTENT_BYTES} (500 KB plaintext cap),
 * non-markdown files, and files inside hidden directories (e.g. `.obsidian/`,
 * `.trash/`) are skipped with per-category counters.
 *
 * Folder matching is case-insensitive within the same parent, so re-running
 * the import against an existing structure reuses folders instead of
 * duplicating them.
 *
 * `duplicateStrategy` controls per-note behavior when an importable note
 * collides with an existing one (same lowercase title in the same target
 * folder). See {@link applyDuplicateStrategy} for semantics. The lookup
 * mutates as the batch progresses, so two files in the source vault sharing
 * a name within the same directory will also be deduplicated against each
 * other (e.g. `Notes.md` + `notes.md` → `Notes.md` + `Notes (2).md`).
 *
 * `opts` (see {@link ImportFolderOptions}) selects where the tree lands:
 * `keepRootFolder` recreates the selected directory itself; `targetFolderId`
 * anchors everything under an existing folder. Combined with the `overwrite`
 * strategy this makes re-importing the same directory an idempotent refresh.
 */
/** A single import entry read, parsed, sanitized, and tag-resolved. */
type PreparedImportFile = {
  relativePath: string;
  folderId: string | undefined;
  title: string;
  sanitizedContent: string;
  tagIds: string[];
  createdAt: string | undefined;
  modifiedAt: string | undefined;
};

/**
 * Read + parse + sanitize a single import entry and resolve its frontmatter
 * tags. Mutates `result.strippedCount` and pushes per-tag failures to
 * `result.errors` (matching the original inline loop); a fatal read/parse error
 * throws so the caller records it against the file and skips it.
 */
async function prepareImportFile(
  entry: { file: File; relativePath: string },
  keepRootFolder: boolean,
  pathToFolderId: Map<string, string | undefined>,
  tagLookup: Array<{ id: string; name: string }>,
  tagsCounter: { count: number },
  result: ImportFolderResult
): Promise<PreparedImportFile> {
  const { file, relativePath } = entry;
  const raw = await file.text();
  const parsed = parseMarkdownFile(raw);
  const segments = extractFolderSegments(relativePath, keepRootFolder);
  const folderId = pathToFolderId.get(segments.join('/'));

  const fallbackTitle = file.name.replace(/\.md$/i, '') || 'Untitled';
  const title = (parsed.title ?? '').trim() || fallbackTitle;

  const { sanitized, stripped } = sanitizeMarkdownContent(parsed.content);
  result.strippedCount += stripped.length;

  const { createdAt, modifiedAt } = pickImportTimestamps(parsed, file.lastModified);

  // Frontmatter tags are global — find-or-create is independent of the per-note
  // duplicate strategy.
  const tagIds: string[] = [];
  if (parsed.tags.length > 0) {
    const { sanitized: safeTags } = sanitizeTags(parsed.tags);
    for (const tagName of safeTags) {
      try {
        tagIds.push(await findOrCreateTagByName(tagName, tagLookup, tagsCounter));
      } catch (e: unknown) {
        result.errors.push(`Tag "${tagName}": ${e instanceof Error ? e.message : 'błąd'}`);
      }
    }
  }

  return {
    relativePath,
    folderId,
    title,
    sanitizedContent: sanitized,
    tagIds,
    createdAt,
    modifiedAt
  };
}

/** Fold a single file's dedup outcome into the running result counters. */
function recordImportOutcome(
  result: ImportFolderResult,
  relativePath: string,
  dedup: DuplicateOutcomeResult
): void {
  // Record the file↔note link for every outcome that resolved to a note (all
  // but `skipped`), so live folder sync can later detect an in-app deletion and
  // re-import the file.
  if (dedup.noteId !== undefined) result.pathToNoteId[relativePath] = dedup.noteId;

  if (dedup.outcome === 'skipped') {
    result.duplicatesSkipped++;
  } else if (dedup.outcome === 'unchanged') {
    result.duplicatesUnchanged++;
  } else {
    if (dedup.outcome === 'overwritten') result.duplicatesOverwritten++;
    else if (dedup.outcome === 'renamed') result.duplicatesRenamed++;
    result.imported++;
  }
}

export async function importFolder(
  files: ImportFolderInput[],
  duplicateStrategy: DuplicateStrategy = 'rename',
  onProgress?: ImportProgressCallback,
  opts?: ImportFolderOptions
): Promise<ImportFolderResult> {
  const result: ImportFolderResult = {
    imported: 0,
    foldersCreated: 0,
    tagsCreated: 0,
    skippedNonMarkdown: 0,
    skippedTooLarge: 0,
    skippedHidden: 0,
    duplicatesSkipped: 0,
    duplicatesOverwritten: 0,
    duplicatesRenamed: 0,
    duplicatesUnchanged: 0,
    strippedCount: 0,
    errors: [],
    pathToNoteId: {},
    linksRewritten: 0
  };
  const keepRootFolder = opts?.keepRootFolder ?? false;
  const targetFolderId = opts?.targetFolderId;
  const tagsOnOverwrite = opts?.tagsOnOverwrite ?? 'replace';
  const pathManifest = opts?.pathManifest;

  // 0. Normalize inputs to { file, relativePath } pairs. Plain Files carry
  //    their path in webkitRelativePath ('' when absent → name only, lands
  //    at the import root, matching the previous behavior).
  const allEntries = files.map((f) =>
    'relativePath' in f ? f : { file: f, relativePath: f.webkitRelativePath || f.name }
  );

  // 1. Skip files in hidden directories (.obsidian/, .trash/, etc.).
  //    Applied FIRST so we don't pollute the non-markdown counter with
  //    .json/.css plugin internals — those get their own bucket.
  const visibleEntries: typeof allEntries = [];
  for (const e of allEntries) {
    if (containsHiddenSegment(e.relativePath)) {
      result.skippedHidden++;
    } else {
      visibleEntries.push(e);
    }
  }

  // 2. Filter non-markdown files.
  const mdEntries: typeof allEntries = [];
  for (const e of visibleEntries) {
    if (e.file.name.toLowerCase().endsWith('.md')) {
      mdEntries.push(e);
    } else {
      result.skippedNonMarkdown++;
    }
  }

  // 3. Filter files exceeding the per-note plaintext cap.
  const sizedEntries: typeof allEntries = [];
  for (const e of mdEntries) {
    if (e.file.size > MAX_NOTE_CONTENT_BYTES) {
      result.skippedTooLarge++;
    } else {
      sizedEntries.push(e);
    }
  }

  // 4. Enforce the shared total-import cap.
  const totalSize = sizedEntries.reduce((sum, e) => sum + e.file.size, 0);
  if (totalSize > MAX_IMPORT_FILE_SIZE) {
    throw new Error(
      `Łączny rozmiar plików (${Math.round(totalSize / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB.`
    );
  }

  if (sizedEntries.length === 0) return result;

  // 5. Load existing folders/tags once so find-or-create can dedupe against
  //    both previous state AND items created earlier in this batch.
  const folderTree = await FolderService.getFolderTree();
  const folderLookup = flattenFolderTree(folderTree);
  const tagLookup: Array<{ id: string; name: string }> = (
    await TagService.getAllTags()
  ).map((t) => ({ id: t.id, name: t.name }));
  const foldersCounter = { count: 0 };
  const tagsCounter = { count: 0 };

  // 5b. Build a per-folder note-title lookup for duplicate detection.
  //     Mirrors the folder/tag find-or-create pattern: snapshot of existing
  //     state, mutated as the batch progresses so files within this import
  //     also dedupe against each other.
  const titleLookup = await buildTitleLookupFromIndex();

  // 6. Resolve every unique directory path to a folder id up-front.
  const pathToFolderId = new Map<string, string | undefined>();
  for (const entry of sizedEntries) {
    const segments = extractFolderSegments(entry.relativePath, keepRootFolder);
    const key = segments.join('/');
    if (pathToFolderId.has(key)) continue;
    try {
      const folderId = await findOrCreateFolderByPath(
        segments,
        folderLookup,
        foldersCounter,
        targetFolderId
      );
      pathToFolderId.set(key, folderId);
    } catch (e: unknown) {
      pathToFolderId.set(key, targetFolderId);
      result.errors.push(`Folder "${key}": ${e instanceof Error ? e.message : 'błąd'}`);
    }
  }
  result.foldersCreated = foldersCounter.count;

  // 7. Import each note. skipSync: true on every write — one ordered bulk push
  //    runs after (step 7b). Two code paths share the resolve/write split:
  //
  //    - Default (no link rewrite): a single streaming pass, resolve → write
  //      per file (one file's content held at a time) — the original behavior.
  //    - Link rewrite ON: TWO passes. First resolve EVERY file's target id (so a
  //      complete relativePath → note id map exists, including ids minted for
  //      brand-new files), then rewrite each file's links against it and write.
  //      Required because a file may link to another imported later in the same
  //      batch; the rewrite runs BEFORE the unchanged-comparison so re-imports
  //      stay idempotent. Holds the changed set's content in memory (bounded by
  //      the 50 MB import cap).
  const total = sizedEntries.length;
  onProgress?.({ phase: 'reading', current: 0, total });
  // Throttle progress events to one per ~50ms so a 1000-file vault doesn't
  // flood the renderer; always report the final count regardless.
  let lastEmit = 0;
  const emitProgress = (current: number) => {
    const now = Date.now();
    if (current === total || now - lastEmit >= 50) {
      onProgress?.({ phase: 'reading', current, total });
      lastEmit = now;
    }
  };

  if (!opts?.rewriteInterNoteLinks) {
    for (let i = 0; i < sizedEntries.length; i++) {
      const entry = sizedEntries[i];
      try {
        const prepared = await prepareImportFile(
          entry,
          keepRootFolder,
          pathToFolderId,
          tagLookup,
          tagsCounter,
          result
        );
        const dedup = await applyDuplicateStrategy({
          baseTitle: prepared.title,
          content: prepared.sanitizedContent,
          folderId: prepared.folderId,
          tagIds: prepared.tagIds,
          tagMode: tagsOnOverwrite,
          createdAt: prepared.createdAt,
          modifiedAt: prepared.modifiedAt,
          lookup: titleLookup,
          strategy: duplicateStrategy,
          // Authoritative for folder sync: a file already linked to a live note
          // overwrites it regardless of the (possibly stale) title lookup.
          manifestNoteId: pathManifest?.[entry.relativePath]
        });
        recordImportOutcome(result, entry.relativePath, dedup);
      } catch (e: unknown) {
        result.errors.push(`${entry.file.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
      emitProgress(i + 1);
    }
  } else {
    // Pass 1 (6b): prepare + resolve every file, building the link map. Seed it
    // with the previous run's manifest so links pointing at files left unchanged
    // this run (folder sync's incremental set) still resolve.
    const linkMap = new Map<string, string>(Object.entries(pathManifest ?? {}));
    const prepared: Array<{ file: PreparedImportFile; target: ResolvedImportTarget }> = [];
    for (const entry of sizedEntries) {
      try {
        const file = await prepareImportFile(
          entry,
          keepRootFolder,
          pathToFolderId,
          tagLookup,
          tagsCounter,
          result
        );
        const target = await resolveImportTarget({
          baseTitle: file.title,
          folderId: file.folderId,
          lookup: titleLookup,
          strategy: duplicateStrategy,
          manifestNoteId: pathManifest?.[entry.relativePath]
        });
        // Every resolved file is a link target — including `skip` (the existing
        // note stays, links to it must still resolve). this-run id overrides any
        // carried-over manifest id (note deleted + re-created gets the fresh id).
        linkMap.set(entry.relativePath, target.noteId);
        prepared.push({ file, target });
      } catch (e: unknown) {
        result.errors.push(
          `${entry.file.name}: ${e instanceof Error ? e.message : 'Unknown error'}`
        );
      }
    }

    // Pass 2 (7c): rewrite links against the complete map, then write. The
    // wikilink index (basename / vault-relative path → note id) is derived once
    // from the same complete map and shared across every file's rewrite.
    const wikilinkIndex = buildWikilinkIndex(linkMap);
    for (let i = 0; i < prepared.length; i++) {
      const { file, target } = prepared[i];
      try {
        const rewrite = rewriteInterNoteLinks(file.sanitizedContent, file.relativePath, linkMap, {
          wikilinks: wikilinkIndex
        });
        const dedup = await writeResolvedNote({
          target,
          content: rewrite.content,
          folderId: file.folderId,
          tagIds: file.tagIds,
          tagMode: tagsOnOverwrite,
          createdAt: file.createdAt,
          modifiedAt: file.modifiedAt
        });
        // Count only links in notes actually (re)written - an idempotent no-op
        // re-sync (`unchanged`) rewrote nothing observable.
        if (
          dedup.outcome === 'created' ||
          dedup.outcome === 'overwritten' ||
          dedup.outcome === 'renamed'
        ) {
          result.linksRewritten += rewrite.rewritten;
        }
        recordImportOutcome(result, file.relativePath, dedup);
      } catch (e: unknown) {
        result.errors.push(`${file.relativePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
      emitProgress(i + 1);
    }
  }
  // Force the final 100% tick: the two-phase write loop iterates the prepared
  // set, which is shorter than `total` when some files failed in pass 1.
  onProgress?.({ phase: 'reading', current: total, total });
  result.tagsCreated = tagsCounter.count;

  // 7b. Trigger one ordered bulk push (folders → tags → notes). All items in
  //     this import were saved with sync_status='pending' (skipSync on every
  //     create call), so pushPendingItems() picks them up and orders pushes
  //     correctly. Without this ordering, notes would POST before their parent
  //     folders, causing the server's folder_id FK check to return 404 and
  //     forcing the client into 1-2s retry backoff per note.
  void pushPendingItems();

  // 8. Rebuild in-memory title index so imports are visible immediately.
  onProgress?.({ phase: 'indexing', current: 0, total: 1 });
  try {
    await noteIndex.rebuild();
  } catch (e: unknown) {
    logger.warn('Failed to rebuild note index after folder import', e);
  }
  onProgress?.({ phase: 'indexing', current: 1, total: 1 });

  logger.info('Folder import complete', result);
  return result;
}
