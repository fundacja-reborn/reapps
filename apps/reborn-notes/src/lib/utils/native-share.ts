/**
 * Native share sheet: `@capacitor/share` on the phones, the Web Share API of
 * the system WebKit in the desktop shell.
 *
 * On the Capacitor build this opens the OS share sheet (send the public share
 * link to any app - mail, messengers, ...). In the desktop shell there is no
 * share plugin: WebKit's own `navigator.share` opens the macOS share menu,
 * where the system WebKit offers it ({@link hasNativeShare}); the UI shows the
 * button only then and keeps "Copy link" either way. On web everything here is
 * an inert no-op returning `false`, so the branches and the plugin are
 * dead-code-eliminated from the web bundle (gated by `__REBORN_NATIVE__`, same
 * pattern as `$lib/utils/native-auth-storage.ts`). Web callers keep their
 * existing clipboard path.
 *
 * Zero-Knowledge note: the link carries the decryption key in its URL fragment
 * (`#k=...`). That is by design - the recipient needs it to decrypt - and is
 * exactly what clipboard copy already shares. We never log the URL here, so the
 * key is not written to any device log.
 *
 * Return contract: `true` means the share sheet was presented (the user may
 * still cancel it - that is success, not a failure). `false` means we are on
 * web, or sharing is unavailable / failed, so the caller should fall back to
 * clipboard.
 */

import { shareLinkCapacitor, type ShareLinkOptions } from '@reborn/platform/native';

/**
 * Whether the share button belongs in the UI. Callers write
 * `__REBORN_NATIVE__ && hasNativeShare()`, so the web build folds it to
 * `false` and drops the button.
 */
export function hasNativeShare(): boolean {
  if (!__REBORN_NATIVE__) return false;
  return __REBORN_DESKTOP__ ? hasWebShare() : true;
}

function hasWebShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareLink(opts: ShareLinkOptions): Promise<boolean> {
  if (!__REBORN_NATIVE__) return false;
  // One branch per build (a constant ternary is what the bundler folds).
  return __REBORN_DESKTOP__ ? shareLinkDesktop(opts) : shareLinkCapacitor(opts);
}

/**
 * Desktop shell: WebKit's share menu. Called straight from the click, with no
 * await before `navigator.share`, so the user gesture it requires is intact.
 */
async function shareLinkDesktop(opts: ShareLinkOptions): Promise<boolean> {
  if (!hasWebShare()) return false;
  try {
    await navigator.share({ title: opts.title, url: opts.url });
    return true;
  } catch (error) {
    // Dismissing the menu is a choice, not a failure. Anything else (no user
    // gesture, sharing refused) falls back to copying, so the button never
    // does nothing.
    return error instanceof DOMException && error.name === 'AbortError';
  }
}
