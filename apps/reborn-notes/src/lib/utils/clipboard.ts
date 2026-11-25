import { copyTextWeb } from '@reborn/platform';
import { copyTextCapacitor } from '@reborn/platform/native';

/**
 * Copy text to the clipboard on web and in the native shells.
 *
 * - **Capacitor shells:** the OS clipboard through `@capacitor/clipboard`
 *   (`copyTextCapacitor`) - the web Clipboard API and `execCommand('copy')`
 *   both report success inside the Android WebView without writing anything
 *   (Faza 3b smoke).
 * - **Web, and the desktop (Tauri) shell:** the async Clipboard API with an
 *   `execCommand` fallback (`copyTextWeb`). The desktop's WKWebView writes the
 *   system clipboard itself, so the desktop bundle leaves the plugin out.
 *
 * Returns true on success so callers can pick the right toast / status.
 */
export function copyText(text: string): Promise<boolean> {
  // One branch per build (a constant ternary is what the bundler folds).
  return __REBORN_NATIVE__ && !__REBORN_DESKTOP__ ? copyTextCapacitor(text) : copyTextWeb(text);
}
