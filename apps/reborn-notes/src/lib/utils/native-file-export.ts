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
 * Gated behind `__REBORN_NATIVE__` with dynamic plugin imports - on the web
 * build the whole module is dead-code-eliminated (pattern: native-share.ts).
 */

/**
 * Subdirectory of the cache dir that exports are written to.
 *
 * Android only shares what the FileProvider path map declares, and that map is
 * scoped to exactly this directory - see android/app/src/main/res/xml/file_paths.xml
 * (audit 014 N2). Renaming it here without renaming it there makes Share.share()
 * throw "Failed to find configured root that contains ..." on Android.
 */
const EXPORT_SUBDIR = 'exports';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}

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
  await (__REBORN_DESKTOP__ ? saveDesktop(filename, data) : shareFromCache(filename, data));
}

async function saveDesktop(filename: string, data: string): Promise<void> {
  const { saveFileDesktop } = await import('./desktop-file-export');
  await saveFileDesktop(filename, data);
}

/** Capacitor: write to the cache dir, then open the system share sheet. */
async function shareFromCache(filename: string, data: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  // No `encoding` option: the Filesystem plugin treats the payload as base64
  // and writes the decoded bytes. Cache directory: OS-managed and reclaimable,
  // never backed up - the file only needs to outlive the share sheet.
  // `recursive` creates EXPORT_SUBDIR on first use; the plugin defaults it to
  // false and then fails the write with a missing-parent-directory error.
  const { uri } = await Filesystem.writeFile({
    path: `${EXPORT_SUBDIR}/${filename}`,
    data,
    directory: Directory.Cache,
    recursive: true
  });

  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: filename, files: [uri] });
  } catch (error) {
    // Dismissing the share sheet rejects with a "canceled" error - that is a
    // user choice, not a failure; the write above already succeeded.
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('cancel')) return;
    throw error;
  }
}
