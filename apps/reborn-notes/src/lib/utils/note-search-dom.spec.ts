import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  nudgeRepaint,
  paintDomHighlights,
  clearDomHighlights,
  paintWidgetHighlights
} from './note-search-dom';

/**
 * Regression (smoke D1, 2026-11-21): in WebKit (Safari, the desktop shell) the
 * find bar left the previous query's highlights on screen - "a" -> "aa" -> "aaa"
 * showed 1/1 while every "a" still glowed, although `CSS.highlights` held only
 * the current ranges. The engine does not repaint the text a highlight is
 * taken off, so every registry change now repaints the container
 * (`nudgeRepaint`). The paint itself can't be asserted in Node; these specs pin
 * the nudge (one toggle per frame) and its wiring at every call site.
 */

type FakeEl = { style: { backgroundImage: string } };
const fakeEl = (): FakeEl => ({ style: { backgroundImage: '' } });
const asEl = (el: FakeEl) => el as unknown as HTMLElement;
const fakeRange = () => ({}) as Range;

let frames: FrameRequestCallback[] = [];
const flushFrame = () => {
  const run = frames;
  frames = [];
  for (const cb of run) cb(0);
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('CSS', { highlights: new Map<string, unknown>() });
  // `Highlight` is a set of ranges; a Set subclass is enough for the registry checks.
  vi.stubGlobal('Highlight', class FakeHighlight extends Set<unknown> {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const registry = () =>
  (globalThis as unknown as { CSS: { highlights: Map<string, Set<unknown>> } }).CSS.highlights;

describe('nudgeRepaint (WebKit stale find highlights)', () => {
  it('toggles an invisible background-image on the next frame, not at once', () => {
    const el = fakeEl();
    nudgeRepaint(asEl(el));
    expect(el.style.backgroundImage).toBe('');
    flushFrame();
    expect(el.style.backgroundImage).toBe('linear-gradient(transparent, transparent)');
  });

  it('toggles back on the next nudge, so every change differs from the last frame', () => {
    const el = fakeEl();
    nudgeRepaint(asEl(el));
    flushFrame();
    nudgeRepaint(asEl(el));
    flushFrame();
    expect(el.style.backgroundImage).toBe('');
  });

  it('coalesces nudges within one frame (two toggles would cancel out)', () => {
    const el = fakeEl();
    nudgeRepaint(asEl(el));
    nudgeRepaint(asEl(el));
    nudgeRepaint(asEl(el));
    expect(frames).toHaveLength(1);
    flushFrame();
    expect(el.style.backgroundImage).not.toBe('');
  });

  it('queues each element separately', () => {
    const a = fakeEl();
    const b = fakeEl();
    nudgeRepaint(asEl(a));
    nudgeRepaint(asEl(b));
    expect(frames).toHaveLength(2);
  });

  it('is a no-op without an element or without requestAnimationFrame', () => {
    nudgeRepaint(null);
    nudgeRepaint(undefined);
    expect(frames).toHaveLength(0);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const el = fakeEl();
    expect(() => nudgeRepaint(asEl(el))).not.toThrow();
    expect(el.style.backgroundImage).toBe('');
  });
});

describe('paint / clear repaint the container after changing the registry', () => {
  it('paintDomHighlights keeps the active range out of the base set and nudges the root', () => {
    const root = fakeEl();
    const ranges = [fakeRange(), fakeRange(), fakeRange()];
    paintDomHighlights(ranges, 1, asEl(root));
    expect([...registry().get('note-search')!]).toEqual([ranges[0], ranges[2]]);
    expect([...registry().get('note-search-active')!]).toEqual([ranges[1]]);
    expect(frames).toHaveLength(1);
    flushFrame();
    expect(root.style.backgroundImage).not.toBe('');
  });

  it('paintDomHighlights without a root changes the registry only', () => {
    paintDomHighlights([fakeRange()], 0);
    expect(registry().get('note-search-active')!.size).toBe(1);
    expect(frames).toHaveLength(0);
  });

  it('clearDomHighlights removes both names and nudges the root', () => {
    const root = fakeEl();
    paintDomHighlights([fakeRange(), fakeRange()], 0);
    clearDomHighlights(asEl(root));
    expect(registry().has('note-search')).toBe(false);
    expect(registry().has('note-search-active')).toBe(false);
    expect(frames).toHaveLength(1);
  });

  it('paintWidgetHighlights nudges every widget root', () => {
    const roots = [fakeEl(), fakeEl()];
    paintWidgetHighlights([fakeRange()], null, roots.map(asEl));
    expect(registry().get('note-search-wgt')!.size).toBe(1);
    expect(registry().has('note-search-wgt-active')).toBe(false);
    flushFrame();
    expect(roots.every((r) => r.style.backgroundImage !== '')).toBe(true);
  });

  it('does nothing without Highlight API support', () => {
    vi.stubGlobal('Highlight', undefined);
    const root = fakeEl();
    paintDomHighlights([fakeRange()], 0, asEl(root));
    clearDomHighlights(asEl(root));
    expect(frames).toHaveLength(0);
  });
});

describe('call sites pass the element to repaint (source wiring)', () => {
  const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf-8');

  it('the notes page repaints the preview when painting and when closing the find bar', () => {
    const page = read('../../routes/+page.svelte');
    expect(page).toMatch(/paintDomHighlights\(ranges, active, previewContentEl\)/);
    const close = page.slice(
      page.indexOf('function closeNoteSearch'),
      page.indexOf('function handleSearchInput')
    );
    expect(close).toMatch(/clearDomHighlights\(previewContentEl\)/);
  });

  it('the editor widget highlighter passes the widget roots it scanned', () => {
    const editor = read('../editor/note-search.ts');
    expect(editor).toMatch(/paintWidgetHighlights\(base, active, roots\)/);
  });
});
