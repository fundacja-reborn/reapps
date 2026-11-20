/**
 * Keeps the browser's "Select all" inside the rendered note (issue #603).
 *
 * The editor is a contenteditable, so the browser already limits Ctrl/Cmd+A
 * and the "Select all" item of the mobile selection menu to it. The preview is
 * plain HTML: there the same command takes the whole page - header, buttons,
 * note list.
 *
 * Nothing tells a page that "Select all" was picked from the mobile menu, and
 * a selection set from script loses the native handles and the Copy menu on
 * Android. So the selection stays native and CSS narrows what it can take:
 * while a scope is on, <html> carries `data-select-scope`, the scoped element
 * `data-select-scope-root`, and app.css makes everything outside that element
 * `user-select: none`.
 *
 * A scope turns on when the user presses inside the element (mouse, touch or
 * pen - a long-press starts with it) and off when they press or move focus
 * anywhere else, so the rest of the app stays selectable as before. An element
 * registered as `primary` (the open note) is also scoped by Ctrl/Cmd+A pressed
 * outside a text field, without a press inside it first.
 */
import { isTextEntryTarget } from './new-note-fab';

export const SELECT_SCOPE_ATTR = 'data-select-scope';
export const SELECT_SCOPE_ROOT_ATTR = 'data-select-scope-root';

export interface SelectAllScopeOptions {
  /**
   * The element is what the screen is about: Ctrl/Cmd+A outside a text field
   * selects it even before the user has pressed inside it.
   */
  primary?: boolean;
}

/** Ctrl/Cmd+A there belongs to the layer itself, not to the note behind it. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const roots = new Map<HTMLElement, boolean>();
let active: HTMLElement | null = null;

function rootOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null;
  for (const root of roots.keys()) {
    if (root.contains(target)) return root;
  }
  return null;
}

function activate(root: HTMLElement): void {
  if (active === root) return;
  deactivate();
  active = root;
  root.setAttribute(SELECT_SCOPE_ROOT_ATTR, '');
  document.documentElement.setAttribute(SELECT_SCOPE_ATTR, '');
}

/**
 * After "Select all" the selection range still spans the whole page - only the
 * CSS kept the rest of it out. Once the scope is gone that rest would light
 * up, so the range is cut down to the element first (or dropped when the
 * element is going away).
 */
function releaseSelection(root: HTMLElement, removing: boolean): void {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const inside = document.createRange();
  inside.selectNodeContents(root);
  // -1: before the element, 0: in it, 1: after it.
  const start = inside.comparePoint(range.startContainer, range.startOffset);
  const end = inside.comparePoint(range.endContainer, range.endOffset);
  if (start === 0 && end === 0) return;
  // Entirely outside the element: not a selection this scope made.
  if (start === 1 || end === -1) return;
  if (removing) {
    selection.removeAllRanges();
    return;
  }
  selection.setBaseAndExtent(
    start === 0 ? range.startContainer : root,
    start === 0 ? range.startOffset : 0,
    end === 0 ? range.endContainer : root,
    end === 0 ? range.endOffset : root.childNodes.length
  );
}

function deactivate(removing = false): void {
  if (!active) return;
  const root = active;
  active = null;
  releaseSelection(root, removing);
  root.removeAttribute(SELECT_SCOPE_ROOT_ATTR);
  document.documentElement.removeAttribute(SELECT_SCOPE_ATTR);
}

function onPointerDown(e: Event): void {
  const root = rootOf(e.target);
  if (root) activate(root);
  else deactivate();
}

function onFocusIn(e: Event): void {
  if (active && e.target instanceof Node && !active.contains(e.target)) deactivate();
}

/**
 * True for the "Select all" shortcut. On a non-Latin layout (Arabic, Russian,
 * ...) `key` is that layout's letter while the shortcut still works, so the
 * physical key decides there. On a Latin layout `key` alone decides: on AZERTY
 * the physical KeyA types "q".
 */
export function isSelectAllShortcut(e: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
  if (e.key.toLowerCase() === 'a') return true;
  return e.code === 'KeyA' && !/^[a-z]$/i.test(e.key);
}

function isShown(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

function onKeyDown(e: KeyboardEvent): void {
  if (active || e.defaultPrevented || !isSelectAllShortcut(e)) return;
  // A text field keeps the command to itself.
  if (isTextEntryTarget(e.target)) return;
  if (e.target instanceof Element && e.target.closest(OVERLAY_SELECTOR)) return;
  for (const [root, primary] of roots) {
    if (primary && isShown(root)) {
      // No preventDefault: the browser selects, the CSS limits it to `root`.
      activate(root);
      return;
    }
  }
}

function listen(): void {
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('keydown', onKeyDown);
}

function unlisten(): void {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('focusin', onFocusIn, true);
  window.removeEventListener('keydown', onKeyDown);
}

/** Svelte action: `use:selectAllScope={{ primary: true }}`. */
export function selectAllScope(node: HTMLElement, options: SelectAllScopeOptions = {}) {
  if (roots.size === 0) listen();
  roots.set(node, options.primary === true);
  return {
    update(next: SelectAllScopeOptions = {}) {
      roots.set(node, next.primary === true);
    },
    destroy() {
      if (active === node) deactivate(true);
      roots.delete(node);
      if (roots.size === 0) unlisten();
    }
  };
}
