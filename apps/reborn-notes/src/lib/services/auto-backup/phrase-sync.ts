/**
 * Account-scoped recovery phrase: keeps the OS-vault copy (the runtime source
 * the backup runner reads) in sync with a WRAPPED copy in the AppSettings row
 * (`autoBackupPhraseWrapped` - the phrase encrypted under the master key).
 *
 * Why: the row rides the E2E synced settings bundle, so the wrapped copy
 * reaches the server (as ciphertext it cannot read) and from there the user's
 * other devices - and it survives logout, because logout only wipes this
 * device. That makes the phrase ONE durable secret per account (the
 * wrapped-recovery-secret pattern used by Ente/Bitwarden), instead of a new
 * phrase per device per enable. The paper copy remains the only
 * disaster-recovery path - this sync is a convenience for logged-in installs,
 * never a substitute for the recovery kit.
 *
 * Zero-Knowledge: the phrase is NEVER stored plaintext outside the OS vault.
 * In the row it is its own AES-GCM ciphertext; in transport it is additionally
 * inside the encrypted settings bundle. No new server exposure: decrypting it
 * requires the master key, which already decrypts everything.
 *
 * Reconcile rules (row = synced truth, vault = device runtime copy):
 *   - row present, vault differs → vault := row (hydration after login on a
 *     fresh/wiped device; also propagates a rotation done on another device)
 *   - row absent, vault present → row := wrap(vault) (migration: publishes the
 *     phrase of installs that predate account scoping; also self-heals after a
 *     settings reset dropped the field)
 *   - row undecryptable, vault present → row := wrap(vault) (a corrupt value
 *     cannot be someone's good rotation - AES-GCM authenticates)
 *
 * Local-only mode has no server sync, but the row copy still matters: the
 * local→account upgrade adopts the local master key, so after upgrading the
 * wrapped copy bootstrap-pushes as-is and the phrase becomes account-scoped.
 */

import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-AutoBackup-PhraseSync');

/** What a reconcile pass did - returned for tests and debug logging. */
export type PhraseReconcileAction =
  | 'hydrated-vault'
  | 'published-row'
  | 'republished-row'
  | 'noop';

/**
 * Injected I/O so the decision logic is testable under vitest, where
 * `__REBORN_NATIVE__` is compile-time false and the real vault is dead code.
 */
export interface PhraseSyncDeps {
  loadVaultPhrase(): Promise<string | null>;
  saveVaultPhrase(phrase: string): Promise<void>;
  /** Current `autoBackupPhraseWrapped` from the AppSettings row (null = absent/no row). */
  getWrappedFromRow(): Promise<string | null>;
  /** Write `autoBackupPhraseWrapped` to the row AND schedule the synced-settings push. */
  setWrappedInRow(wrapped: string): Promise<void>;
  wrap(phrase: string): Promise<string>;
  /** Must reject on tamper/garbage (AES-GCM auth failure). */
  unwrap(wrapped: string): Promise<string>;
}

/** Pure reconcile core - see the module doc for the rule table. */
export async function reconcilePhraseCore(deps: PhraseSyncDeps): Promise<PhraseReconcileAction> {
  const [wrapped, vaultPhrase] = await Promise.all([
    deps.getWrappedFromRow(),
    deps.loadVaultPhrase()
  ]);

  if (wrapped) {
    let rowPhrase: string;
    try {
      rowPhrase = await deps.unwrap(wrapped);
    } catch {
      // Authenticated decryption failed - the row value is garbage, not a
      // rotation we could be clobbering. Re-publish the vault copy if we have
      // one; otherwise leave the corrupt value for a device that does.
      if (!vaultPhrase) return 'noop';
      await deps.setWrappedInRow(await deps.wrap(vaultPhrase));
      return 'republished-row';
    }
    if (!rowPhrase || rowPhrase === vaultPhrase) return 'noop';
    await deps.saveVaultPhrase(rowPhrase);
    return 'hydrated-vault';
  }

  if (vaultPhrase) {
    await deps.setWrappedInRow(await deps.wrap(vaultPhrase));
    return 'published-row';
  }

  return 'noop';
}

/**
 * Reconcile the vault with the synced row on this device. Native-only (web has
 * no vault and no auto-backup) and requires the master key for wrap/unwrap.
 * Never throws - a failed reconcile must not break the backup run or the
 * settings page; the next trigger retries.
 */
export async function reconcileRecoveryPhrase(): Promise<PhraseReconcileAction> {
  if (!__REBORN_NATIVE__) return 'noop';
  if (!cryptoManager.isInitialized()) return 'noop';
  try {
    const action = await reconcilePhraseCore(await nativeDeps());
    if (action !== 'noop') logger.info('Recovery phrase reconciled:', action);
    return action;
  } catch (err) {
    logger.warn('Recovery phrase reconcile failed:', err);
    return 'noop';
  }
}

/**
 * Store a NEWLY confirmed phrase everywhere at once: OS vault (runtime copy)
 * plus the wrapped row copy (account scope). Used by the settings page after
 * the user confirms they wrote the phrase down. Vault write errors propagate
 * (the enable flow must warn the user - see saveRecoveryPhrase); a failed row
 * publish is only logged, because the next reconcile pass republishes it.
 */
export async function storeRecoveryPhrase(phrase: string): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  const { saveRecoveryPhrase } = await import('./recovery-phrase-vault');
  await saveRecoveryPhrase(phrase);
  try {
    const deps = await nativeDeps();
    await deps.setWrappedInRow(await deps.wrap(phrase));
  } catch (err) {
    logger.warn('Publishing the wrapped phrase to synced settings failed:', err);
  }
}

/** Real I/O wiring. Lazy store imports keep this module cheap to load on web. */
async function nativeDeps(): Promise<PhraseSyncDeps> {
  const [{ loadRecoveryPhrase, saveRecoveryPhrase }, { appSettings }] = await Promise.all([
    import('./recovery-phrase-vault'),
    import('$lib/stores/app-settings.store')
  ]);
  const { getSettings } = await import('$lib/utils/app-settings');
  return {
    loadVaultPhrase: loadRecoveryPhrase,
    saveVaultPhrase: saveRecoveryPhrase,
    getWrappedFromRow: async () => (await getSettings())?.autoBackupPhraseWrapped ?? null,
    // appSettings.update writes IDB, refreshes the store and schedules the
    // debounced synced-settings push - the same path every other setting uses.
    setWrappedInRow: (wrapped) => appSettings.update('autoBackupPhraseWrapped', wrapped),
    wrap: (phrase) => cryptoManager.encryptText(phrase),
    unwrap: (wrapped) => cryptoManager.decryptText(wrapped)
  };
}
