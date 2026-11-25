import { copyTextWeb } from '@reborn/platform';
import { copyTextCapacitor } from '@reborn/platform/native';

/**
 * Copy text to the clipboard on web and in the native shells.
 *
 * - **Native (Capacitor):** the OS clipboard through `@capacitor/clipboard`.
 *   Inside the Android WebView both the web Clipboard API and
 *   `execCommand('copy')` report success without writing anything (re/notes
 *   Faza 3b smoke), so the shell never uses them.
 * - **Web:** the async Clipboard API with an `execCommand` fallback.
 *
 * Throws when nothing was copied, so call sites keep their existing
 * `try { await ...writeText() } catch { ... }` error handling.
 */
export async function copyText(text: string): Promise<void> {
	// One branch per build (a constant ternary is what the bundler folds).
	const ok = await (__REBORN_NATIVE__ ? copyTextCapacitor(text) : copyTextWeb(text));
	if (!ok) throw new Error('copy to clipboard failed');
}
