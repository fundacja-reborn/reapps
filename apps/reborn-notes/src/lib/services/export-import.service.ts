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
  FolderWithChildren
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
  deriveKeyFromPassword,
  generateSalt,
  encryptData,
  decryptData,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  cryptoManager
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
  findExisting,
  rememberTitle,
  folderKey,
  type DuplicateStrategy,
  type TitleLookup
} from './import-dedup-utils';
import { sanitizeMarkdownContent, sanitizeTags } from '$lib/utils/markdown-sanitizer';
import { shouldRestoreFromTrash, shouldRelinkToBackupFolder } from './export-import-trash-utils';
import {
  normalizeNullToUndefined,
  formatZodIssues,
  FOLDER_OPTIONAL_FIELDS,
  NOTE_OPTIONAL_FIELDS,
  TAG_OPTIONAL_FIELDS
} from './import-normalize-utils';

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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(name: string): string {
  return (name.replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim() || 'untitled').slice(0, 100);
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
export function exportNoteAsMarkdown(note: NoteDecrypted, tagNames: string[] = []): void {
  const content = buildMarkdownContent(note, tagNames);
  const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' });
  downloadBlob(blob, `${sanitizeFilename(note.title)}.md`);
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
    for (const child of Array.from(bodyEl.children)) {
      collect(child);
      // Descend one level for lists — breaking between <li> on the same page
      // is much friendlier than slicing through a single bullet.
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        for (const li of Array.from(child.children)) collect(li);
      }
    }
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

    pdf.save(`${filename}.pdf`);
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
  downloadBlob(blob, `${archiveName}.zip`);
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
  downloadBlob(blob, `reborn-notes-backup-${date}.json`);
}

/**
 * Export a password-encrypted JSON backup.
 * Uses PBKDF2 to derive an AES-256-GCM key from the user-provided password.
 * The output file contains: version, salt (base64), iv (base64), data (base64 ciphertext).
 * This backup can be imported on any account with the correct password.
 *
 * Zero Knowledge: shadow indexes are stripped before encryption (defense in
 * depth — even if the password leaks, no extra signal beyond what's already
 * in `metadata_encrypted`).
 */
export async function exportEncryptedBackup(password: string): Promise<void> {
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
    exported_at: new Date().toISOString(),
    app: 'reborn-notes',
    data: { notes: sanitizedNotes, folders: sanitizedFolders, tags: sanitizedTags }
  };

  const json = JSON.stringify(backup);
  const salt = await generateSalt(16);
  const key = await deriveKeyFromPassword(password, salt);
  const { encryptedData, iv } = await encryptData(json, key);

  const envelope = {
    version: 2,
    encryption: 'aes-256-gcm-pbkdf2',
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encryptedData)
  };

  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/json; charset=utf-8'
  });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `reborn-notes-backup-encrypted-${date}.json`);
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
 * Check if a backup file is encrypted (version 2).
 * Call this before importJsonBackup to know if a password is needed.
 */
export function isEncryptedBackup(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return parsed.version === 2 && typeof parsed.encryption === 'string';
  } catch {
    return false;
  }
}

/**
 * Import a JSON backup file (version 1 plaintext or version 2 encrypted).
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

  if (parsed.version === 2) {
    // Encrypted backup
    if (!password) throw new Error('Ten backup jest zaszyfrowany. Podaj hasło.');
    const envelope = parsed as BackupV2;
    const salt = base64ToArrayBuffer(envelope.salt);
    const iv = base64ToArrayBuffer(envelope.iv);
    const ciphertext = base64ToArrayBuffer(envelope.data);
    const key = await deriveKeyFromPassword(password, salt);
    let decrypted: string;
    try {
      decrypted = (await decryptData(ciphertext, key, iv, 'string')) as string;
    } catch {
      throw new Error('Nieprawidłowe hasło lub uszkodzony plik backupu.');
    }
    const inner = JSON.parse(decrypted);
    backupData = inner.data;
  } else if (parsed.version === 1) {
    // Plaintext backup
    backupData = (parsed as BackupV1).data;
  } else {
    throw new Error('Nieznany format backupu.');
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
      const { outcome, noteId } = await applyDuplicateStrategy({
        baseTitle,
        content: sanitized,
        folderId,
        tagIds: [],
        modifiedAt,
        createdAt,
        lookup,
        strategy: duplicateStrategy
      });
      if (outcome === 'skipped') {
        result.duplicatesSkipped++;
      } else {
        if (outcome === 'overwritten') result.duplicatesOverwritten++;
        else if (outcome === 'renamed') result.duplicatesRenamed++;
        result.imported++;
        // Push the freshly-saved note (skipSync was true on the storage write).
        const note = await noteStore.get(noteId);
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
 * `skipped` does not bump the imported counter (existing note left alone);
 * the others all produce a persisted note. `noteId` is `undefined` for
 * `skipped` only — callers that bulk-push on completion should iterate
 * over the populated ids.
 */
type DuplicateOutcomeResult =
  | { outcome: 'created' | 'overwritten' | 'renamed'; noteId: string }
  | { outcome: 'skipped'; noteId: undefined };

/**
 * Apply the selected duplicate-handling strategy for a single file.
 *
 * Mutates `lookup` so subsequent files in the same batch see the just-created
 * / just-renamed entry and don't double-collide with it.
 *
 * `tagIds` is the list of tag ids resolved from frontmatter (already
 * find-or-created by the caller). For `overwrite`, this REPLACES the
 * existing note's tag set — frontmatter is treated as the source of truth.
 */
async function applyDuplicateStrategy(args: {
  baseTitle: string;
  content: string;
  folderId: string | undefined;
  tagIds: string[];
  createdAt: string | undefined;
  modifiedAt: string | undefined;
  lookup: TitleLookup;
  strategy: DuplicateStrategy;
}): Promise<DuplicateOutcomeResult> {
  const { baseTitle, content, folderId, tagIds, createdAt, modifiedAt, lookup, strategy } = args;
  const existingId = findExisting(lookup, folderId, baseTitle);

  if (!existingId) {
    const newId = await NoteService.createNote(baseTitle, content, folderId, {
      createdAt,
      updatedAt: modifiedAt ?? createdAt,
      skipSync: true
    });
    if (tagIds.length > 0) {
      await TagService.setTagsForNote(newId, tagIds, { skipSync: true });
    }
    rememberTitle(lookup, folderId, baseTitle, newId);
    return { outcome: 'created', noteId: newId };
  }

  if (strategy === 'skip') {
    return { outcome: 'skipped', noteId: undefined };
  }

  if (strategy === 'overwrite') {
    await NoteService.updateNote(existingId, baseTitle, content, {
      updatedAt: modifiedAt ?? new Date().toISOString(),
      skipSync: true
    });
    // Replace tag set with frontmatter tags (source of truth on overwrite).
    await TagService.setTagsForNote(existingId, tagIds, { skipSync: true });
    return { outcome: 'overwritten', noteId: existingId };
  }

  // strategy === 'rename'
  const takenLower = new Set<string>();
  const bucket = lookup.get(folderKey(folderId));
  if (bucket) for (const k of bucket.keys()) takenLower.add(k);
  const renamedTitle = computeRenamedTitle(baseTitle, takenLower);
  const newId = await NoteService.createNote(renamedTitle, content, folderId, {
    createdAt,
    updatedAt: modifiedAt ?? createdAt,
    skipSync: true
  });
  if (tagIds.length > 0) {
    await TagService.setTagsForNote(newId, tagIds, { skipSync: true });
  }
  rememberTitle(lookup, folderId, renamedTitle, newId);
  return { outcome: 'renamed', noteId: newId };
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
 */
async function findOrCreateFolderByPath(
  pathSegments: string[],
  lookup: FolderLookupEntry[],
  counter: { count: number }
): Promise<string | undefined> {
  if (pathSegments.length === 0) return undefined;

  let parentId: string | undefined = undefined;
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
  strippedCount: number;
  errors: string[];
};

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
 */
export async function importFolder(
  files: File[],
  duplicateStrategy: DuplicateStrategy = 'rename',
  onProgress?: ImportProgressCallback
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
    strippedCount: 0,
    errors: []
  };

  // 1. Skip files in hidden directories (.obsidian/, .trash/, etc.).
  //    Applied FIRST so we don't pollute the non-markdown counter with
  //    .json/.css plugin internals — those get their own bucket.
  const visibleFiles: File[] = [];
  for (const f of files) {
    if (containsHiddenSegment(f.webkitRelativePath)) {
      result.skippedHidden++;
    } else {
      visibleFiles.push(f);
    }
  }

  // 2. Filter non-markdown files.
  const mdFiles: File[] = [];
  for (const f of visibleFiles) {
    if (f.name.toLowerCase().endsWith('.md')) {
      mdFiles.push(f);
    } else {
      result.skippedNonMarkdown++;
    }
  }

  // 3. Filter files exceeding the per-note plaintext cap.
  const sizedFiles: File[] = [];
  for (const f of mdFiles) {
    if (f.size > MAX_NOTE_CONTENT_BYTES) {
      result.skippedTooLarge++;
    } else {
      sizedFiles.push(f);
    }
  }

  // 4. Enforce the shared total-import cap.
  const totalSize = sizedFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_IMPORT_FILE_SIZE) {
    throw new Error(
      `Łączny rozmiar plików (${Math.round(totalSize / 1024 / 1024)} MB) przekracza limit ${Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB.`
    );
  }

  if (sizedFiles.length === 0) return result;

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
  for (const file of sizedFiles) {
    const segments = extractFolderSegments(file.webkitRelativePath);
    const key = segments.join('/');
    if (pathToFolderId.has(key)) continue;
    try {
      const folderId = await findOrCreateFolderByPath(segments, folderLookup, foldersCounter);
      pathToFolderId.set(key, folderId);
    } catch (e: unknown) {
      pathToFolderId.set(key, undefined);
      result.errors.push(`Folder "${key}": ${e instanceof Error ? e.message : 'błąd'}`);
    }
  }
  result.foldersCreated = foldersCounter.count;

  // 7. Import each note via the duplicate strategy helper.
  //    skipSync: true — avoid per-note pushNote/pushNoteUpdate race condition.
  //    Bulk push happens after the loop (step 7b).
  const total = sizedFiles.length;
  onProgress?.({ phase: 'reading', current: 0, total });
  // Throttle progress events to one per ~50ms so a 1000-file vault doesn't
  // flood the renderer; always report the final count regardless.
  let lastEmit = 0;

  for (let i = 0; i < sizedFiles.length; i++) {
    const file = sizedFiles[i];
    try {
      const raw = await file.text();
      const parsed = parseMarkdownFile(raw);
      const segments = extractFolderSegments(file.webkitRelativePath);
      const folderId = pathToFolderId.get(segments.join('/'));

      const fallbackTitle = file.name.replace(/\.md$/i, '') || 'Untitled';
      const title = (parsed.title ?? '').trim() || fallbackTitle;

      const { sanitized: sanitizedContent, stripped } = sanitizeMarkdownContent(parsed.content);
      result.strippedCount += stripped.length;

      const { createdAt, modifiedAt } = pickImportTimestamps(parsed, file.lastModified);

      // Resolve frontmatter tags up-front — tags are global, so find-or-create
      // is independent of the per-note duplicate strategy.
      const tagIds: string[] = [];
      if (parsed.tags.length > 0) {
        const { sanitized: safeTags } = sanitizeTags(parsed.tags);
        for (const tagName of safeTags) {
          try {
            const tagId = await findOrCreateTagByName(tagName, tagLookup, tagsCounter);
            tagIds.push(tagId);
          } catch (e: unknown) {
            result.errors.push(`Tag "${tagName}": ${e instanceof Error ? e.message : 'błąd'}`);
          }
        }
      }

      const { outcome } = await applyDuplicateStrategy({
        baseTitle: title,
        content: sanitizedContent,
        folderId,
        tagIds,
        createdAt,
        modifiedAt,
        lookup: titleLookup,
        strategy: duplicateStrategy
      });

      if (outcome === 'skipped') {
        result.duplicatesSkipped++;
      } else {
        if (outcome === 'overwritten') result.duplicatesOverwritten++;
        else if (outcome === 'renamed') result.duplicatesRenamed++;
        result.imported++;
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
