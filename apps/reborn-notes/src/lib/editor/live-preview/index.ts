/**
 * Live Preview extension for CodeMirror 6.
 *
 * Hides Markdown markers outside the editing block and renders inline elements
 * with preview-like typography. Toggled at runtime via a Compartment in
 * NoteEditor.svelte based on the user's `editorMode` setting.
 *
 * Scope: ATX headings, **bold**, *italic*, `inline code`, links (incl. note:UUID),
 * blockquote, bullet/ordered lists, GFM task lists (`- [ ]` / `- [x]` with an
 * interactive checkbox widget), fenced code blocks (```lang ... ```), GFM
 * tables (always rendered as an editable widget — Obsidian-style), and inline
 * images (`![alt](url)` — placeholder/auto-load per user preference, raw
 * markdown when the cursor is inside the image range).
 */
import type { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import type { ImageLoadMode } from '@reborn/storage';
import {
  createLivePreviewField,
  livePreviewSyncListener,
  livePreviewAtomicRanges,
  livePreviewListClickForward,
  livePreviewTaskCheckboxToggle
} from './decorations';
import { livePreviewTheme } from './theme';
import { codeLanguages } from './code-languages';
import { loadedImagesField, type ImageWidgetLabels } from './image-widget';
import type { CodeCopyLabels } from './code-copy';

/**
 * Runtime options for the Live Preview extension. The Compartment in
 * NoteEditor reconfigures the whole extension whenever any option changes.
 */
export interface LivePreviewOptions {
  /** User preference for external image loading. */
  imageLoadMode?: ImageLoadMode;
  /** i18n labels used inside DOM widgets (cannot read Svelte stores there). */
  imageLabels?: ImageWidgetLabels;
  /** i18n labels for the fenced-code copy button. */
  codeLabels?: CodeCopyLabels;
}

const DEFAULT_LABELS: ImageWidgetLabels = {
  load: 'Load image',
  base64Blocked: 'Embedded images are not supported'
};

const DEFAULT_CODE_LABELS: CodeCopyLabels = {
  copy: 'Copy code',
  copied: 'Copied'
};

export function createLivePreviewExtension(options: LivePreviewOptions = {}): Extension {
  const field = createLivePreviewField({
    imageLoadMode: options.imageLoadMode ?? 'ask',
    imageLabels: options.imageLabels ?? DEFAULT_LABELS,
    codeLabels: options.codeLabels ?? DEFAULT_CODE_LABELS
  });
  return [
    field,
    loadedImagesField,
    livePreviewSyncListener,
    livePreviewAtomicRanges,
    livePreviewListClickForward,
    livePreviewTaskCheckboxToggle,
    livePreviewTheme
  ];
}

/**
 * Markdown parser config shared by both editor modes. Extracted as a helper
 * because both raw and Live Preview need the same parser features (GFM
 * Strikethrough + Table + Task list + nested code-language descriptors).
 * Used by NoteEditor.svelte.
 */
export function getMarkdownExtension(): Extension {
  return markdown({ extensions: [Strikethrough, Table, TaskList], codeLanguages });
}

export {
  buildDecorations,
  isAnySelectionInRange,
  createLivePreviewField,
  livePreviewField,
  livePreviewSyncListener,
  livePreviewAtomicRanges,
  livePreviewListClickForward,
  livePreviewTaskCheckboxToggle,
  rebuildLivePreview,
  type BuildDecorationsOptions
} from './decorations';
export {
  CodeBlockWidget,
  LinkWidget,
  registerCodeBlockView,
  renderHighlighted,
  sanitizeInfoClass,
  sanitizeLinkUrl
} from './widgets';
export {
  ImageWidget,
  sanitizeImageSrc,
  isDataImageUri,
  loadImageEffect,
  loadedImagesField,
  getLoadedImages,
  type ImageWidgetLabels
} from './image-widget';
export { TableWidget, tableCellEditAnnotation } from './table-widget';
export {
  highlightCodeToHtml,
  triggerLanguageLoad,
  escapeHtml,
  normalizeCodeText
} from './highlight-html';
export {
  CODE_COPY_ICON,
  CODE_CHECK_ICON,
  copyCodeFromButton,
  type CodeCopyLabels
} from './code-copy';
export { codeLanguages, matchLanguage, getLoadedLanguage } from './code-languages';
export {
  parseTable,
  serializeTable,
  type ParsedTable,
  type ParsedCell,
  type CellAlign
} from './table-parse';
