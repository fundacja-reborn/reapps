import type { Action } from 'svelte/action';

export interface LongPressOptions {
  /** Press duration (ms) before the callback fires. */
  threshold?: number;
  /** Pointer movement (px) that cancels the press — distinguishes from scroll. */
  moveTolerance?: number;
  /** Only fire for touch / pen pointers. Mouse will be ignored. Default: true. */
  touchOnly?: boolean;
}

type LongPressCallback = (event: PointerEvent) => void;

/**
 * Long-press action for entering multi-select mode on touch devices.
 *
 * Cancels on `pointermove > moveTolerance` so vertical scrolling does not
 * accidentally trigger selection — this is the most common false positive
 * if you only listen to `pointerdown`/`pointerup`.
 *
 * `touchOnly: true` (default) skips mouse: desktop entry into selection mode
 * is via the visible-on-hover checkbox or Ctrl/Cmd-click, not long-press.
 *
 * Usage:
 *   <div use:longPress={() => enterSelection(note.id)}>
 *   <div use:longPress={{ callback, threshold: 700 }}>
 */
export const longPress: Action<
  HTMLElement,
  LongPressCallback | ({ callback: LongPressCallback } & LongPressOptions)
> = (node, param) => {
  let callback: LongPressCallback;
  let threshold = 1000;
  let moveTolerance = 10;
  let touchOnly = true;

  function applyParam(p: typeof param) {
    if (typeof p === 'function') {
      callback = p;
      threshold = 1000;
      moveTolerance = 10;
      touchOnly = true;
    } else {
      callback = p.callback;
      threshold = p.threshold ?? 1000;
      moveTolerance = p.moveTolerance ?? 10;
      touchOnly = p.touchOnly ?? true;
    }
  }
  applyParam(param);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let activePointerId: number | null = null;
  let fired = false;
  // Armed when the long-press callback fires, consumed by the next `click`
  // event so the parent's onclick (which would otherwise treat the post-press
  // click as a selection-mode toggle and immediately undo the entry) is
  // suppressed exactly once.
  let suppressNextClickArmed = false;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reset() {
    clearTimer();
    activePointerId = null;
    fired = false;
  }

  function onPointerDown(e: PointerEvent) {
    // Only primary button — right/middle clicks must not pin `activePointerId`
    // or they would suppress their own native contextmenu via `onContextMenu`.
    if (e.button !== 0) return;
    // Mouse on pure desktop is skipped — selection-mode entry there is via the
    // hover-checkbox or Ctrl/Cmd-click. We allow mouse when ANY signal hints
    // at a touch / mobile context: real touchscreens (maxTouchPoints > 0), or
    // a mobile-width viewport (DevTools device-mode emulation in browsers like
    // Brave that only resize the viewport without translating pointerType).
    // Threshold matches the project mobile breakpoint (`breakpoints.mobile`).
    if (
      touchOnly &&
      e.pointerType === 'mouse' &&
      (typeof navigator === 'undefined' || navigator.maxTouchPoints === 0) &&
      (typeof window === 'undefined' || window.innerWidth > 768)
    )
      return;
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      timer = null;
      suppressNextClickArmed = true;
      callback(e);
    }, threshold);
  }

  function onClick(e: Event) {
    if (!suppressNextClickArmed) return;
    suppressNextClickArmed = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > moveTolerance * moveTolerance) {
      reset();
    }
  }

  function onPointerEnd(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return;
    reset();
  }

  function onContextMenu(e: Event) {
    // Suppress the OS/browser native long-press contextmenu while a press is
    // in flight or just fired — without this, touch users and mobile-emulation
    // see the system context menu before/instead of our callback.
    if (activePointerId !== null || fired) {
      e.preventDefault();
    }
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerEnd);
  node.addEventListener('pointercancel', onPointerEnd);
  node.addEventListener('pointerleave', onPointerEnd);
  node.addEventListener('contextmenu', onContextMenu);
  // Capture-phase so we run before the parent's onclick handler bubbles.
  node.addEventListener('click', onClick, { capture: true });

  return {
    update(next) {
      applyParam(next);
    },
    destroy() {
      reset();
      suppressNextClickArmed = false;
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerEnd);
      node.removeEventListener('pointercancel', onPointerEnd);
      node.removeEventListener('pointerleave', onPointerEnd);
      node.removeEventListener('contextmenu', onContextMenu);
      node.removeEventListener('click', onClick, { capture: true });
    }
  };
};

/**
 * Internal helper exported for testing — pure logic for press/cancel decision.
 * Returns whether a press starting at `(startX,startY)` and currently at
 * `(curX,curY)` should be cancelled given `moveTolerance`.
 */
export function exceedsMoveTolerance(
  startX: number,
  startY: number,
  curX: number,
  curY: number,
  moveTolerance: number
): boolean {
  const dx = curX - startX;
  const dy = curY - startY;
  return dx * dx + dy * dy > moveTolerance * moveTolerance;
}
