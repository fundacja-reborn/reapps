// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isSelectAllShortcut,
  selectAllScope,
  SELECT_SCOPE_ATTR,
  SELECT_SCOPE_ROOT_ATTR
} from './select-all-scope';

/**
 * Issue #603: "Select all" in the rendered note took the whole app. The fix
 * leaves the selection to the browser and flags what may be selected; these
 * specs pin when the flags go on and off. What the browser then selects is CSS
 * (app.css) and is checked by hand.
 */

type Scope = ReturnType<typeof selectAllScope>;

const html = document.documentElement;
let chrome: HTMLElement;
let note: HTMLElement;
let scopes: Scope[] = [];

function mount(el: HTMLElement, primary = false): Scope {
  const scope = selectAllScope(el, { primary });
  scopes.push(scope);
  return scope;
}

/** jsdom lays nothing out: every element reports no boxes unless told to. */
function show(el: HTMLElement): void {
  el.getClientRects = () => [{}] as unknown as DOMRectList;
}

function press(target: Element): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function selectAllKey(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...init
  });
  target.dispatchEvent(event);
  return event;
}

function isScoped(el: HTMLElement): boolean {
  return html.hasAttribute(SELECT_SCOPE_ATTR) && el.hasAttribute(SELECT_SCOPE_ROOT_ATTR);
}

beforeEach(() => {
  document.body.innerHTML = `
    <header id="chrome"><button id="mode">Preview</button><input id="search" /></header>
    <div id="note"><p id="first">First line</p><p id="last">Last line</p></div>
    <footer id="after">Synced</footer>`;
  chrome = document.getElementById('chrome')!;
  note = document.getElementById('note')!;
});

afterEach(() => {
  for (const scope of scopes) scope.destroy();
  scopes = [];
  document.getSelection()?.removeAllRanges();
});

describe('selectAllScope - pressing', () => {
  it('is off until the user presses inside the element', () => {
    mount(note);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
    expect(note.hasAttribute(SELECT_SCOPE_ROOT_ATTR)).toBe(false);
  });

  it('turns on for a press inside the element (a long-press starts with one)', () => {
    mount(note);
    press(document.getElementById('first')!);
    expect(isScoped(note)).toBe(true);
  });

  it('turns off for a press anywhere else', () => {
    mount(note);
    press(note);
    press(chrome);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
    expect(note.hasAttribute(SELECT_SCOPE_ROOT_ATTR)).toBe(false);
  });

  it('turns off when focus moves out of the element', () => {
    mount(note);
    press(note);
    document.getElementById('search')!.focus();
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });

  it('moves from one element to another', () => {
    const other = document.createElement('div');
    document.body.append(other);
    mount(note);
    mount(other);
    press(note);
    press(other);
    expect(isScoped(other)).toBe(true);
    expect(note.hasAttribute(SELECT_SCOPE_ROOT_ATTR)).toBe(false);
  });

  it('cleans up when the element goes away, and stops listening', () => {
    const scope = mount(note);
    press(note);
    scope.destroy();
    scopes = [];
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
    expect(note.hasAttribute(SELECT_SCOPE_ROOT_ATTR)).toBe(false);
    press(note);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });
});

describe('selectAllScope - Ctrl/Cmd+A without a press first', () => {
  it('scopes the primary element and leaves the selecting to the browser', () => {
    mount(note, true);
    show(note);
    const event = selectAllKey(document.getElementById('mode')!);
    expect(isScoped(note)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('works with Cmd as well', () => {
    mount(note, true);
    show(note);
    selectAllKey(document.body, { ctrlKey: false, metaKey: true });
    expect(isScoped(note)).toBe(true);
  });

  it('ignores an element that is not primary', () => {
    mount(note);
    show(note);
    selectAllKey(document.body);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });

  it('ignores a primary element that is not shown', () => {
    mount(note, true);
    selectAllKey(document.body);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });

  it('picks the shown one of two primary elements (mobile and desktop layouts)', () => {
    const hidden = document.createElement('div');
    document.body.prepend(hidden);
    mount(hidden, true);
    mount(note, true);
    show(note);
    selectAllKey(document.body);
    expect(isScoped(note)).toBe(true);
    expect(hidden.hasAttribute(SELECT_SCOPE_ROOT_ATTR)).toBe(false);
  });

  it('leaves a text field alone', () => {
    mount(note, true);
    show(note);
    selectAllKey(document.getElementById('search')!);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });

  it('leaves a dialog alone', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<button>Close</button>';
    document.body.append(dialog);
    mount(note, true);
    show(note);
    selectAllKey(dialog.querySelector('button')!);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });

  it('leaves a shortcut another handler already took (note list multi-select)', () => {
    mount(note, true);
    show(note);
    const take = (e: Event) => e.preventDefault();
    document.body.addEventListener('keydown', take);
    selectAllKey(document.body);
    document.body.removeEventListener('keydown', take);
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });

  it('follows a changed `primary` option', () => {
    const scope = mount(note);
    show(note);
    scope.update({ primary: true });
    selectAllKey(document.body);
    expect(isScoped(note)).toBe(true);
  });

  it('ignores other shortcuts', () => {
    mount(note, true);
    show(note);
    selectAllKey(document.body, { key: 'c', code: 'KeyC' });
    selectAllKey(document.body, { shiftKey: true });
    selectAllKey(document.body, { ctrlKey: false });
    expect(html.hasAttribute(SELECT_SCOPE_ATTR)).toBe(false);
  });
});

describe('selectAllScope - a selection that spans the page', () => {
  /** What "Select all" leaves behind: the range covers the whole document. */
  function selectWholePage(): Selection {
    const selection = document.getSelection()!;
    selection.selectAllChildren(document.body);
    return selection;
  }

  it('is cut down to the element when the scope turns off', () => {
    mount(note);
    press(note);
    const selection = selectWholePage();
    press(chrome);
    const range = selection.getRangeAt(0);
    expect(range.startContainer).toBe(note);
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(note);
    expect(range.endOffset).toBe(note.childNodes.length);
    expect(selection.toString()).toBe('First lineLast line');
  });

  it('keeps an end that is already inside the element', () => {
    mount(note);
    press(note);
    const selection = document.getSelection()!;
    const lastText = document.getElementById('last')!.firstChild!;
    selection.setBaseAndExtent(document.body, 0, lastText, 4);
    press(chrome);
    const range = selection.getRangeAt(0);
    expect(range.startContainer).toBe(note);
    expect(range.endContainer).toBe(lastText);
    expect(range.endOffset).toBe(4);
  });

  it('is dropped when the element goes away', () => {
    const scope = mount(note);
    press(note);
    const selection = selectWholePage();
    scope.destroy();
    scopes = [];
    expect(selection.rangeCount).toBe(0);
  });

  it('is left alone when it lies inside the element', () => {
    mount(note);
    press(note);
    const selection = document.getSelection()!;
    const firstText = document.getElementById('first')!.firstChild!;
    selection.setBaseAndExtent(firstText, 0, firstText, 5);
    press(chrome);
    expect(selection.toString()).toBe('First');
  });

  it('is left alone when it lies entirely outside the element', () => {
    mount(note);
    press(note);
    const selection = document.getSelection()!;
    selection.selectAllChildren(document.getElementById('after')!);
    press(chrome);
    expect(selection.toString()).toBe('Synced');
  });
});

describe('isSelectAllShortcut', () => {
  const base = { metaKey: false, ctrlKey: true, altKey: false, shiftKey: false };

  it('accepts Ctrl+A and Cmd+A, in either case', () => {
    expect(isSelectAllShortcut({ ...base, key: 'a', code: 'KeyA' })).toBe(true);
    expect(isSelectAllShortcut({ ...base, key: 'A', code: 'KeyA' })).toBe(true);
    expect(
      isSelectAllShortcut({ ...base, ctrlKey: false, metaKey: true, key: 'a', code: 'KeyA' })
    ).toBe(true);
  });

  it('goes by the physical key on a non-Latin layout (Arabic)', () => {
    expect(isSelectAllShortcut({ ...base, key: String.fromCodePoint(0x0634), code: 'KeyA' })).toBe(
      true
    );
  });

  it('goes by the letter on a Latin layout (AZERTY: "a" sits on KeyQ, KeyA types "q")', () => {
    expect(isSelectAllShortcut({ ...base, key: 'a', code: 'KeyQ' })).toBe(true);
    expect(isSelectAllShortcut({ ...base, key: 'q', code: 'KeyA' })).toBe(false);
  });

  it('rejects a plain "a" and combinations with Shift or Alt', () => {
    expect(isSelectAllShortcut({ ...base, ctrlKey: false, key: 'a', code: 'KeyA' })).toBe(false);
    expect(isSelectAllShortcut({ ...base, shiftKey: true, key: 'A', code: 'KeyA' })).toBe(false);
    expect(isSelectAllShortcut({ ...base, altKey: true, key: 'a', code: 'KeyA' })).toBe(false);
  });
});
