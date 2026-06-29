/**
 * Live Preview extension for CodeMirror 6.
 *
 * Hides Markdown markers outside the editing block and renders inline elements
 * with preview-like typography. Toggled at runtime via a Compartment in
 * NoteEditor.svelte based on the user's `editorMode` setting.
 *
 * Scope: ATX headings, **bold**, *italic*, `inline code`, links (incl. note:UUID),
 * blockquote, horizontal rules (`---` / `***` / `___` rendered as a divider,
 * raw when the cursor is on the line), bullet/ordered lists, GFM task lists
 * (`- [ ]` / `- [x]` with an interactive checkbox widget), fenced code blocks
 * (```lang ... ```), GFM tables (always rendered as an editable widget —
 * Obsidian-style), and inline images (`![alt](url)` — placeholder/auto-load
 * per user preference, raw markdown when the cursor is inside the image range).
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
  livePreviewTaskCheckboxToggle,
  livePreviewTocActions,
  livePreviewAnchorScroll,
  type TocActions
} from './decorations';
import { livePreviewTheme } from './theme';
import { codeLanguages } from './code-languages';
import { loadedImagesField, type ImageWidgetLabels } from './image-widget';
import type { CodeCopyLabels } from './code-copy';
import type { TocWidgetLabels } from './toc-widget';
import type { TableWidgetLabels } from './table-widget';

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
  /** i18n labels for the in-note TOC corner toolbar. */
  tocLabels?: TocWidgetLabels;
  /** aria-label / tooltip for the per-heading "copy link" button. */
  headingLinkLabel?: string;
  /** i18n labels for the editable table's structural mini-toolbar. */
  tableLabels?: TableWidgetLabels;
  /** Owner callbacks for the TOC refresh / remove buttons. */
  tocActions?: TocActions;
}

const DEFAULT_LABELS: ImageWidgetLabels = {
  load: 'Load image',
  base64Blocked: 'Embedded images are not supported'
};

const DEFAULT_CODE_LABELS: CodeCopyLabels = {
  copy: 'Copy code',
  copied: 'Copied'
};

const DEFAULT_TOC_LABELS: TocWidgetLabels = {
  refresh: 'Refresh',
  stale: 'Out of date - refresh',
  remove: 'Remove'
};

const DEFAULT_HEADING_LINK_LABEL = 'Copy link to heading';

const DEFAULT_TABLE_LABELS: TableWidgetLabels = {
  alignLeft: 'Align column left',
  alignCenter: 'Align column center',
  alignRight: 'Align column right',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  deleteColumn: 'Delete column',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  deleteRow: 'Delete row'
};

export function createLivePreviewExtension(options: LivePreviewOptions = {}): Extension {
  const field = createLivePreviewField({
    imageLoadMode: options.imageLoadMode ?? 'ask',
    imageLabels: options.imageLabels ?? DEFAULT_LABELS,
    codeLabels: options.codeLabels ?? DEFAULT_CODE_LABELS,
    tocLabels: options.tocLabels ?? DEFAULT_TOC_LABELS,
    headingLinkLabel: options.headingLinkLabel ?? DEFAULT_HEADING_LINK_LABEL,
    tableLabels: options.tableLabels ?? DEFAULT_TABLE_LABELS
  });
  return [
    field,
    loadedImagesField,
    livePreviewSyncListener,
    livePreviewAtomicRanges,
    livePreviewListClickForward,
    livePreviewTaskCheckboxToggle,
    livePreviewTocActions(options.tocActions),
    livePreviewAnchorScroll,
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
  livePreviewTocActions,
  livePreviewAnchorScroll,
  rebuildLivePreview,
  type BuildDecorationsOptions,
  type TocActions
} from './decorations';
export { TocWidget, type TocWidgetLabels } from './toc-widget';
export { HeadingAnchorWidget, HEADING_LINK_ICON } from './heading-anchor-widget';
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
export {
  TableWidget,
  tableCellEditAnnotation,
  wrapCellSelection,
  type TableWidgetLabels
} from './table-widget';
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
