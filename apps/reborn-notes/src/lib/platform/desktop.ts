/**
 * Desktop (Tauri) platform implementation for the reborn-notes shell.
 *
 * The desktop shell is a native build (`__REBORN_NATIVE__`: bundled static SPA,
 * token auth, no Service Worker) without the Capacitor bridge, so the plugins
 * behind `./native` are not there. This third implementation covers the same
 * capabilities with what the window itself offers:
 *
 * - network: the web's active HTTP probe against the remote API's `/health`,
 *   carried by the shell's HTTP transport (`desktop-fetch.ts`);
 * - lifecycle: the window being in front (see {@link createDesktopLifecycle});
 * - back button, deep links: none on desktop (deep links come later).
 *
 * Selected in `./index.ts` only when `__REBORN_DESKTOP__` is true, so the web
 * and Capacitor bundles drop this module.
 */
import { getConnectivity } from '@reborn/api-client';
import type {
  Platform,
  PlatformBackButton,
  PlatformDeepLinks,
  PlatformLifecycle
} from '@reborn/platform';
import { API_BASE } from '$lib/utils/api-base';
import { isShellDialogOpen, onShellDialogClosed } from '$lib/utils/desktop-bridge';

/**
 * How long after a system dialog closes the window may take to get its focus
 * back before the app counts as left. The focus event normally follows within
 * a frame or two; this only bounds the wait.
 */
export const DIALOG_FOCUS_GRACE_MS = 500;

/** The parts of `window` / `document` the lifecycle reads. */
export interface LifecycleView {
  window: Pick<EventTarget, 'addEventListener'>;
  document: Pick<EventTarget, 'addEventListener'> & {
    readonly visibilityState: DocumentVisibilityState;
    hasFocus(): boolean;
  };
}

/** Hooks into the shell's dialog tracking, injectable for tests. */
export interface ShellDialogs {
  isOpen(): boolean;
  onClosed(listener: () => void): () => void;
}

const shellDialogs: ShellDialogs = { isOpen: isShellDialogOpen, onClosed: onShellDialogClosed };

/**
 * Foreground / background for a desktop window.
 *
 * On a phone "background" means the app is off screen. A desktop window is in
 * the foreground while it is visible AND focused: switching to another app
 * (blur), minimizing it, hiding it with Cmd+H or locking the screen (hidden)
 * all count as leaving, and getting both back counts as returning. `onPause`
 * and `onResume` fire on those transitions only, so App Lock times the time
 * away and the layout syncs on return - as on mobile.
 *
 * System dialogs the app opens itself (the unlock prompt, the folder picker,
 * "Save as...") also take the focus. While one is open the window keeps its
 * foreground state, and when it closes the window gets a short grace period to
 * take the focus back. Without that, unlocking with "Re-lock: immediately"
 * would lock the app again the moment Touch ID succeeded.
 *
 * Listeners attach on the first subscription, like on web.
 */
export function createDesktopLifecycle(
  view: LifecycleView = { window, document },
  dialogs: ShellDialogs = shellDialogs
): PlatformLifecycle {
  const resume = new Set<() => void>();
  const pause = new Set<() => void>();
  // The window was just opened by the user, so it starts in front. A real
  // focus event that follows is then no transition (no sync storm at launch).
  let foreground = view.document.visibilityState === 'visible';
  let attached = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  const evaluate = () => {
    const visible = view.document.visibilityState === 'visible';
    // A dialog of our own may hold the foreground, but never create it: a
    // dialog that opens while the app is in the background is not a return.
    const next = visible && (view.document.hasFocus() || (foreground && dialogs.isOpen()));
    if (next === foreground) return;
    foreground = next;
    // Snapshot so a handler that unsubscribes mid-iteration is safe.
    for (const handler of [...(next ? resume : pause)]) handler();
  };

  const ensureAttached = () => {
    if (attached) return;
    attached = true;
    view.window.addEventListener('focus', evaluate);
    view.window.addEventListener('blur', evaluate);
    view.document.addEventListener('visibilitychange', evaluate);
    dialogs.onClosed(() => {
      clearTimeout(graceTimer);
      graceTimer = setTimeout(evaluate, DIALOG_FOCUS_GRACE_MS);
    });
  };

  return {
    onResume(handler) {
      ensureAttached();
      resume.add(handler);
      return () => resume.delete(handler);
    },
    onPause(handler) {
      ensureAttached();
      pause.add(handler);
      return () => pause.delete(handler);
    }
  };
}

/** No hardware back button on desktop. */
function createDesktopBackButton(): PlatformBackButton {
  return {
    setHandler() {
      /* no-op on desktop */
    }
  };
}

/** Deep links are not wired on desktop yet (plugin `deep-link`, after v1). */
function createDesktopDeepLinks(): PlatformDeepLinks {
  return {
    onOpen() {
      return () => {
        /* never fires */
      };
    }
  };
}

/** Assemble the desktop platform. */
export function createDesktopPlatform(): Platform {
  return {
    isNative: true,
    network: getConnectivity({ endpoint: `${API_BASE}/health` }),
    lifecycle: createDesktopLifecycle(),
    backButton: createDesktopBackButton(),
    deepLinks: createDesktopDeepLinks()
  };
}
