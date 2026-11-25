import { blobToBase64, shareFileFromCache } from '@reborn/platform/native';

/**
 * Save a file the user asked for (data export, backup codes, a shared task as
 * Markdown).
 *
 * - **Web:** an `<a download>` click on a blob URL - the browser saves it.
 * - **Native (Capacitor):** WKWebView silently ignores `<a download>` on blob
 *   URLs (re/notes Faza 4 smoke), so the shell writes the file to the app cache
 *   and opens the system share sheet ("Save to Files", AirDrop, mail...) -
 *   `shareFileFromCache` in `@reborn/platform/native`, the same path re/notes
 *   uses. Dismissing the sheet is a user choice, not an error.
 *
 * The native branch is dead code on web (`__REBORN_NATIVE__` is a build-time
 * `false`), so the web bundle keeps only the anchor path.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
	if (__REBORN_NATIVE__) {
		await shareFileFromCache(filename, await blobToBase64(blob));
		return;
	}
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	// Defer revoke so the browser has time to start the download.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
