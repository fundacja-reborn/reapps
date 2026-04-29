/**
 * Live Preview extension for CodeMirror 6.
 *
 * Hides Markdown markers outside the editing block and renders inline elements
 * with preview-like typography. Toggled at runtime via a Compartment in
 * NoteEditor.svelte based on the user's `editorMode` setting.
 *
 * Scope: ATX headings, **bold**, *italic*, `inline code`, links (incl. note:UUID),
 * blockquote, bullet/ordered lists, fenced code blocks (```lang ... ```),
 * GFM tables (always rendered as an editable widget — Obsidian-style).
 * Inline images stay as raw markdown.
 */
import type { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table } from '@lezer/markdown';
import {
  livePreviewField,
  livePreviewSyncListener,
  livePreviewAtomicRanges
} from './decorations';
import { livePreviewTheme } from './theme';
import { codeLanguages } from './code-languages';

export function createLivePreviewExtension(): Extension {
  return [
    livePreviewField,
    livePreviewSyncListener,
    livePreviewAtomicRanges,
    livePreviewTheme
  ];
}

/**
 * Markdown parser config shared by both editor modes. Extracted as a helper
 * because both raw and Live Preview need the same parser features (GFM
 * Strikethrough + Table + nested code-language descriptors). Used by NoteEditor.svelte.
 */
export function getMarkdownExtension(): Extension {
  return markdown({ extensions: [Strikethrough, Table], codeLanguages });
}

export {
  buildDecorations,
  isAnySelectionInRange,
  livePreviewField,
  livePreviewSyncListener,
  livePreviewAtomicRanges,
  rebuildLivePreview
} from './decorations';
export {
  CodeBlockWidget,
  LinkWidget,
  registerCodeBlockView,
  renderHighlighted,
  sanitizeInfoClass,
  sanitizeLinkUrl
} from './widgets';
export { TableWidget, tableCellEditAnnotation } from './table-widget';
export {
  highlightCodeToHtml,
  triggerLanguageLoad,
  escapeHtml
} from './highlight-html';
export { codeLanguages, matchLanguage, getLoadedLanguage } from './code-languages';
export {
  parseTable,
  serializeTable,
  type ParsedTable,
  type ParsedCell,
  type CellAlign
} from './table-parse';
