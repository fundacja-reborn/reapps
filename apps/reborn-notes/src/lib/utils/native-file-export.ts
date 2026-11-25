/**
 * Native (Capacitor) file export: write the blob to the app cache directory
 * and hand it to the system share sheet ("Save to Files", AirDrop, mail...).
 *
 * WKWebView silently ignores `<a download>` clicks on blob: URLs (no error,
 * no save dialog - confirmed on the iOS simulator during the Faza 4 smoke),
 * so the web download helper cannot work in the iOS shell. Android WebView
 * does support anchor downloads, but the share sheet is the better mobile
 * export UX and keeps both shells on one code path, so the native branch
 * covers both platforms.
 *
 * The Capacitor half (cache dir + share sheet, the FileProvider-scoped
 * `exports/` subdirectory) is `shareFileFromCache` in `@reborn/platform/native`.
 * Gated behind `__REBORN_NATIVE__` - on the web build the whole module is
 * dead-code-eliminated (pattern: native-share.ts).
 */

import { blobToBase64, shareFileFromCache } from '@reborn/platform/native';

/**
 * Export `blob` as `filename`: the system share sheet on the phones, "Save
 * as..." in the desktop shell.
 */
export async function exportFileNative(blob: Blob, filename: string): Promise<void> {
  if (!__REBORN_NATIVE__) {
    throw new Error('native file export is native-only');
  }

  const data = await blobToBase64(blob);

  // Desktop (Tauri) shell: a desktop has no share sheet and the Capacitor
  // plugins do not exist there - the system "Save as..." dialog is the export
  // UX (see desktop-file-export.ts). One branch per build (a constant ternary
  // is what the bundler folds; a block with a return keeps the code after it).
  await (__REBORN_DESKTOP__ ? saveDesktop(filename, data) : shareFileFromCache(filename, data));
}

async function saveDesktop(filename: string, data: string): Promise<void> {
  const { saveFileDesktop } = await import('./desktop-file-export');
  await saveFileDesktop(filename, data);
}
