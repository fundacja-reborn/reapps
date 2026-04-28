/**
 * Live Preview extension for CodeMirror 6.
 *
 * Hides Markdown markers outside the editing block and renders inline elements
 * with preview-like typography. Toggled at runtime via a Compartment in
 * NoteEditor.svelte based on the user's `editorMode` setting.
 *
 * Scope: ATX headings, **bold**, *italic*, `inline code`, links (incl. note:UUID),
 * blockquote, bullet/ordered lists. Tables, fenced code blocks, and images stay
 * as raw markdown.
 */
import type { Extension } from '@codemirror/state';
import { livePreviewField } from './decorations';
import { livePreviewTheme } from './theme';

export function createLivePreviewExtension(): Extension {
  return [livePreviewField, livePreviewTheme];
}

export { buildDecorations, isAnySelectionInRange } from './decorations';
export { LinkWidget, sanitizeLinkUrl } from './widgets';
