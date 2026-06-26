/**
 * Guard against importing an account-key "Encrypted Backup" on the WRONG account.
 *
 * The encrypted backup ({@link DataExportService.exportEncrypted}) carries
 * ciphertext keyed by the originating account's master key. Imported on a
 * different account it cannot be decrypted: the old importer saved the untouched
 * ciphertext, which surfaced as blank rows and then sync-rejected on push (task
 * PK unique violation / ownership-guard 403) - a silent failure. The supported
 * cross-account path is the portable, password-protected backup, which carries
 * plaintext re-encrypted with the importing account's key.
 *
 * This module is a pure probe (crypto injected) so it unit-tests without the
 * full import service (IndexedDB stores, cryptoManager, sync queue). Mirrors the
 * light-helper pattern of `portable-import-utils.ts`. Zero Knowledge: it only
 * attempts local decryption; no plaintext, keys, or server contact leave.
 */

/**
 * True if AT LEAST ONE probe ciphertext decrypts with the current account key -
 * i.e. this encrypted backup belongs to the importing account and is safe to
 * restore. False means none decrypted: a cross-account backup that would import
 * as unreadable rows.
 *
 * Probe a single ciphertext per entity kind (list name, task title, subtask
 * name): a cross-account backup fails the AES-GCM auth tag on every field, while
 * a same-account restore decrypts on the first probe. A leading corrupt field
 * falls through to the next kind, so a lone bad row can't misflag an otherwise
 * readable backup. An empty backup (no probes) is trivially readable - there is
 * nothing to misread.
 *
 * `decrypt` rejects on an authentication-tag mismatch (wrong key) or malformed
 * input; both count as "this probe did not decrypt" and the next kind is tried.
 */
export async function isEncryptedBackupReadable(
	probes: ReadonlyArray<string | undefined | null>,
	decrypt: (ciphertext: string) => Promise<string>
): Promise<boolean> {
	const candidates = probes.filter(
		(c): c is string => typeof c === 'string' && c.length > 0
	);
	if (candidates.length === 0) return true;
	for (const ciphertext of candidates) {
		try {
			await decrypt(ciphertext);
			return true;
		} catch {
			// Wrong key / corrupt field - try the next entity kind.
		}
	}
	return false;
}
