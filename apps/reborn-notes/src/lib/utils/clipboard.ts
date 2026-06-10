/**
 * Copy text to the clipboard on both web and the Capacitor Android WebView.
 *
 * The async Clipboard API (`navigator.clipboard.writeText`) is the preferred
 * path and is used verbatim on the web (HTTPS secure context). In the native
 * Android WebView it is feature-gated and rejects - the shell is served from
 * `http://localhost` (see capacitor.config `androidScheme`) - which surfaced as
 * "Failed to copy" during Faza 3b native smoke testing. We then fall back to the
 * legacy `document.execCommand('copy')` via an off-screen textarea, which the
 * WebView still honours as long as the call runs inside a user gesture (every
 * caller here is a click/submit handler).
 *
 * Returns true on success so callers can pick the right toast / status. Web
 * behaviour is unchanged: the async path resolves first, the fallback is never
 * reached, and on web it is in any case a harmless no-op of the same effect.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // WebView rejected the async API - fall through to the execCommand path.
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
