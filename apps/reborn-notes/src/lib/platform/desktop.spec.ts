/**
 * Desktop lifecycle: when the window counts as left / returned to.
 *
 * App Lock times the time away from `onPause` to `onResume`, and the layout
 * syncs on `onResume`, so a spurious pair (a Touch ID prompt, a "Save as..."
 * panel) would re-lock the app right after unlocking it with "Re-lock:
 * immediately". The view and the shell's dialog tracking are injected, so the
 * spec runs without a DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// `desktop.ts` reads the API base for its network probe; SvelteKit's `$app`
// / `$env` modules behind the real one do not exist under vitest.
vi.mock('$lib/utils/api-base', () => ({ API_BASE: 'http://api.test/notes/api' }));

import { createDesktopLifecycle, DIALOG_FOCUS_GRACE_MS, type ShellDialogs } from './desktop';

function fakeView() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    focused: true,
    hasFocus(): boolean {
      return this.focused;
    }
  });
  return {
    view: { window, document },
    blur() {
      document.focused = false;
      window.dispatchEvent(new Event('blur'));
    },
    focus() {
      document.focused = true;
      window.dispatchEvent(new Event('focus'));
    },
    setVisible(visible: boolean) {
      document.visibilityState = visible ? 'visible' : 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    }
  };
}

function fakeDialogs() {
  let open = 0;
  const listeners = new Set<() => void>();
  const dialogs: ShellDialogs = {
    isOpen: () => open > 0,
    onClosed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return {
    dialogs,
    open() {
      open += 1;
    },
    close() {
      open -= 1;
      for (const listener of listeners) listener();
    }
  };
}

describe('desktop lifecycle', () => {
  let win: ReturnType<typeof fakeView>;
  let shell: ReturnType<typeof fakeDialogs>;
  let resume: Mock<() => void>;
  let pause: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    win = fakeView();
    shell = fakeDialogs();
    const lifecycle = createDesktopLifecycle(win.view, shell.dialogs);
    resume = vi.fn<() => void>();
    pause = vi.fn<() => void>();
    lifecycle.onResume(resume);
    lifecycle.onPause(pause);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses when the user switches to another app and resumes on return', () => {
    win.blur();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();

    win.focus();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('pauses when the window is hidden even if it kept the focus', () => {
    win.setVisible(false);
    expect(pause).toHaveBeenCalledTimes(1);

    win.setVisible(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('fires once per transition', () => {
    win.blur();
    win.setVisible(false);
    win.setVisible(true); // visible again, but still not focused
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();

    win.focus();
    win.focus();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('starts in front: the first focus event after launch is no return', () => {
    win.focus();

    expect(resume).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('ignores the focus a system dialog of the app takes', () => {
    shell.open();
    win.blur();
    shell.close();
    win.focus();
    vi.advanceTimersByTime(DIALOG_FOCUS_GRACE_MS);

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('counts the app as left when the focus does not come back after a dialog', () => {
    shell.open();
    win.blur();
    shell.close();
    expect(pause).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DIALOG_FOCUS_GRACE_MS);
    expect(pause).toHaveBeenCalledTimes(1);

    win.focus();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not let a dialog bring a background app to the front', () => {
    win.blur();
    shell.open();
    win.setVisible(true); // any re-evaluation while the dialog is open
    shell.close();
    vi.advanceTimersByTime(DIALOG_FOCUS_GRACE_MS);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it('still pauses when the window is hidden during a dialog', () => {
    shell.open();
    win.setVisible(false);

    expect(pause).toHaveBeenCalledTimes(1);
    shell.close();
  });
});
