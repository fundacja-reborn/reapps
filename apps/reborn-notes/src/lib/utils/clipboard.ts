/**
 * Copy text to the clipboard on both web and the Capacitor Android WebView.
 *
 * - **Native (Capacitor):** the OS clipboard via `@capacitor/clipboard` (the
 *   native ClipboardManager). The web Clipboard API and `execCommand('copy')`
 *   are both unreliable inside the Android WebView (regardless of the local
 *   scheme): they either reject or resolve/return true WITHOUT ever
 *   writing to the system clipboard, which surfaced during Faza 3b smoke testing
 *   as a "copied" toast over an empty clipboard. The plugin bypasses the WebView
 *   entirely. The dynamic import sits behind `__REBORN_NATIVE__` so the web build
 *   dead-code-eliminates both the branch and the plugin (same pattern as
 *   `$lib/utils/native-auth-storage.ts`).
 * - **Web:** the async Clipboard API, with a legacy `execCommand('copy')`
 *   fallback for the rare insecure-context case.
 *
 * Returns true on success so callers can pick the right toast / status.
 */
export async function copyText(text: string): Promise<boolean> {
  if (__REBORN_NATIVE__) {
    try {
      const { Clipboard } = await import('@capacitor/clipboard');
      await Clipboard.write({ string: text });
      return true;
    } catch {
      return false;
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Async Clipboard API rejected - fall through to the execCommand path.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    // Keep it off-screen and out of the scroll/layout flow while selected.
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
