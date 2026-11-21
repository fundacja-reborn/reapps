/**
 * File export for the desktop (Tauri) shell: the system "Save as..." dialog,
 * behind the shell's `file_export_save` command
 * (`src-tauri/src/file_export.rs`).
 *
 * WKWebView ignores `<a download>` on blob: URLs, so the web download helper
 * cannot work in the shell; on mobile the same gap is closed by the share
 * sheet. Here the user picks the destination in a native dialog: the page
 * only suggests a file name and hands over the bytes, it never names a path.
 */

import { invokeDesktopDialog } from './desktop-bridge';

/**
 * Offer `base64` (the file content) for saving under the suggested `filename`.
 * Resolves `false` when the user dismissed the dialog - a choice, not a
 * failure. A failed write rejects with an Error (the shell rejects with a
 * bare string, which the export callers' `error.message` handling would miss).
 */
export async function saveFileDesktop(filename: string, base64: string): Promise<boolean> {
  try {
    const { saved } = await invokeDesktopDialog<{ saved: boolean }>('file_export_save', {
      name: filename,
      data: base64
    });
    return saved;
  } catch (rejection) {
    throw rejection instanceof Error ? rejection : new Error(String(rejection));
  }
}
