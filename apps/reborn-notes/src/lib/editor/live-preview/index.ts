/**
 * Live Preview extension for CodeMirror 6.
 *
 * Hides Markdown markers outside the editing block and renders inline elements
 * with preview-like typography. Toggled at runtime via a Compartment in
 * NoteEditor.svelte based on the user's `editorMode` setting.
 *
 * Scope: ATX headings, **bold**, *italic*, `inline code`, links (incl. note:UUID),
 * blockquote, bullet/ordered lists, fenced code blocks (```lang ... ```).
 * Tables and inline images stay as raw markdown.
 */
import type { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { Strikethrough } from '@lezer/markdown';
import { livePreviewField } from './decorations';
import { livePreviewTheme } from './theme';
import { codeLanguages } from './code-languages';

export function createLivePreviewExtension(): Extension {
  return [livePreviewField, livePreviewTheme];
}

/**
 * Markdown parser config shared by both editor modes. Extracted as a helper
 * because both raw and Live Preview need the same parser features (GFM
 * Strikethrough + nested code-language descriptors). Used by NoteEditor.svelte.
 */
export function getMarkdownExtension(): Extension {
  return markdown({ extensions: [Strikethrough], codeLanguages });
}

export {
  buildDecorations,
  isAnySelectionInRange,
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
export { codeLanguages, matchLanguage, getLoadedLanguage } from './code-languages';
