/**
 * Puts the editor content into its own compositing layer in the desktop
 * shell (Tauri on macOS), where WebKit otherwise leaves stale paint behind.
 *
 * What happened: in the shell's WKWebView, a change of the editor's layout
 * (Live Preview revealing `##` or `**` when the cursor enters a heading or
 * bold text, a table getting a new column) sometimes did not repaint the old
 * area. The old and the new text showed on top of each other until the next
 * full repaint (a window resize); the DOM was right all along (seen
 * 2026-11-21). Safari on the same Mac, the same WebKit, did not do it, so
 * the embedded view draws differently from the browser, and that is outside
 * the page's control.
 *
 * Why this helps: with `will-change: transform` WebKit keeps the content in
 * a layer of its own and repaints the changed area of that layer. In a manual
 * test (dozens of clicks, edits and resizes) the stale paint did not come back.
 *
 * Desktop build only: the bug was seen only there, and elsewhere a layer as
 * tall as the whole note would cost memory for nothing.
 */
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export const desktopRepaintLayer: Extension = /* @__PURE__ */ EditorView.theme({
  '.cm-content': { willChange: 'transform' }
});
