/**
 * Native share sheet via `@capacitor/share`.
 *
 * On the native build this opens the OS share sheet (send the public share link
 * to any app - mail, messengers, ...). On web it is an inert no-op returning
 * `false`, so the whole branch and the plugin are dead-code-eliminated from the
 * web bundle (gated by `__REBORN_NATIVE__`, same pattern as
 * `$lib/utils/native-auth-storage.ts`). Web callers keep their existing
 * clipboard path.
 *
 * Zero-Knowledge note: the link carries the decryption key in its URL fragment
 * (`#k=...`). That is by design - the recipient needs it to decrypt - and is
 * exactly what clipboard copy already shares. We never log the URL here, so the
 * key is not written to any device log.
 *
 * Return contract: `true` means the native sheet was presented (the user may
 * still cancel it - that is success, not a failure). `false` means we are on
 * web, or the plugin is unavailable / failed to load, so the caller should fall
 * back to clipboard.
 */
export async function shareLink(opts: {
  url: string;
  title?: string;
  dialogTitle?: string;
}): Promise<boolean> {
  if (__REBORN_NATIVE__) {
    try {
      const { Share } = await import('@capacitor/share');
      const can = await Share.canShare().catch(() => ({ value: true }));
      if (!can.value) return false;
      try {
        await Share.share({
          title: opts.title,
          url: opts.url,
          dialogTitle: opts.dialogTitle
        });
      } catch {
        // The sheet was presented; a throw here is a user cancel or a transient
        // OS hiccup. Treat as handled - do NOT fall back to clipboard (that
        // would surprise a user who deliberately dismissed the sheet).
      }
      return true;
    } catch {
      // Plugin missing / failed to load - let the caller fall back to clipboard.
      return false;
    }
  }
  return false;
}
