/**
 * Copy text with the web platform's own means: the async Clipboard API, with a
 * legacy `execCommand('copy')` fallback for the rare insecure-context case.
 *
 * Used by the web build and the desktop (Tauri) shell, whose WKWebView writes
 * the system clipboard itself. NOT for the Capacitor shells: inside the Android
 * WebView both paths are unreliable - they either reject or report success
 * WITHOUT writing to the system clipboard (Faza 3b smoke: a "copied" toast over
 * an empty clipboard). There the apps use `copyTextCapacitor` from
 * `@reborn/platform/native`.
 *
 * Returns true on success so callers can pick the right toast / status.
 */
export async function copyTextWeb(text: string): Promise<boolean> {
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
