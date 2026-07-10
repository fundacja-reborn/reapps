/**
 * Account-scoped recovery phrase: keeps the OS-vault copy (the runtime source
 * the backup runner reads) in sync with a WRAPPED copy in the AppSettings row
 * (`autoBackupPhrase` - the phrase encrypted under the master key, plus its
 * own freshness stamp).
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
 * Conflict safety (settings sync is whole-row last-write-wins, which the
 * phrase must not inherit - a stale device pushing an unrelated setting would
 * otherwise revert the account's newest phrase and silently make every backup
 * taken since undecryptable with the phrase the user wrote down):
 *   - the row copy carries its own `updatedAt`; bundle merge and pull-repair
 *     are newest-wins on that stamp (settings-bundle / synced-settings),
 *   - publishing a vault-only phrase to the row is gated on a DEFINITIVE
 *     server view this session (`markSettingsPullSucceeded`, or local-only
 *     mode where no server exists) - never on "the field is absent locally",
 *     which is indistinguishable from "the pull failed",
 *   - when hydration REPLACES a non-empty vault phrase, a notice flag is set
 *     for the backup settings page: the user must re-view and re-record the
 *     now-current phrase instead of trusting a stale written kit.
 *
 * Reconcile rules (row = newest known after pull-merge, vault = device copy):
 *   - row present, vault empty   → hydrate vault (fresh login / wiped device)
 *   - row present, vault differs → replace vault + set the notice flag
 *   - row absent, vault present  → publish wrap(vault) IF publishing allowed
 *     (migration of pre-scoping installs; self-heal after a settings reset)
 *   - row undecryptable          → republish from vault (GCM auth failure
 *     cannot be someone's good rotation), or noop with no vault copy
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
  | 'replaced-vault'
  | 'published-row'
  | 'republished-row'
  | 'noop';

/**
 * One-shot per JS context: flips true once a settings pull obtained a
 * definitive server view (see `fetched` in SyncedSettingsService.pullAndMerge).
 * Gates the publish branch - see the module doc's conflict-safety notes.
 */
let settingsPullSucceeded = false;

/** Called from the root layout after a pull that definitively saw the server. */
export function markSettingsPullSucceeded(): void {
  settingsPullSucceeded = true;
}

/**
 * Injected I/O so the decision logic is testable under vitest, where
 * `__REBORN_NATIVE__` is compile-time false and the real vault is dead code.
 */
export interface PhraseSyncDeps {
  loadVaultPhrase(): Promise<string | null>;
  saveVaultPhrase(phrase: string): Promise<void>;
  /** Current `autoBackupPhrase` from the AppSettings row (null = absent/no row). */
  getRowPhrase(): Promise<{ wrapped: string; updatedAt: string } | null>;
  /**
   * Write `autoBackupPhrase` to the row (stamping a fresh `updatedAt`) AND
   * schedule the synced-settings push.
   */
  setRowPhrase(wrapped: string): Promise<void>;
  wrap(phrase: string): Promise<string>;
  /** Must reject on tamper/garbage (AES-GCM auth failure). */
  unwrap(wrapped: string): Promise<string>;
  /** Flag the settings page: the vault phrase was replaced from the account. */
  notePhraseReplaced(): void;
}

/** Pure reconcile core - see the module doc for the rule table. */
export async function reconcilePhraseCore(
  deps: PhraseSyncDeps,
  opts: { allowPublish: boolean }
): Promise<PhraseReconcileAction> {
  const [rowPhrase, vaultPhrase] = await Promise.all([
    deps.getRowPhrase(),
    deps.loadVaultPhrase()
  ]);

  if (rowPhrase) {
    let phrase: string;
    try {
      phrase = await deps.unwrap(rowPhrase.wrapped);
    } catch {
      // Authenticated decryption failed - the row value is garbage, not a
      // rotation we could be clobbering. Re-publish the vault copy if we have
      // one; otherwise leave the corrupt value for a device that does.
      if (!vaultPhrase) return 'noop';
      await deps.setRowPhrase(await deps.wrap(vaultPhrase));
      return 'republished-row';
    }
    if (!phrase || phrase === vaultPhrase) return 'noop';
    await deps.saveVaultPhrase(phrase);
    if (vaultPhrase) {
      // The device held a DIFFERENT phrase: backups already in its folder
      // stay decryptable with the old one, but everything from now on uses
      // the account phrase - the user must re-view and re-record it.
      deps.notePhraseReplaced();
      return 'replaced-vault';
    }
    return 'hydrated-vault';
  }

  if (vaultPhrase && opts.allowPublish) {
    await deps.setRowPhrase(await deps.wrap(vaultPhrase));
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
    // Publishing is safe when this session definitively saw the server state,
    // or in local-only mode where the row never leaves the device.
    const { localOnly } = await import('$lib/stores/sync-status.store');
    const { get } = await import('svelte/store');
    const allowPublish = get(localOnly) || settingsPullSucceeded;
    const action = await reconcilePhraseCore(await nativeDeps(), { allowPublish });
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
 * the user confirms they wrote the phrase down - an explicit user action, so
 * it publishes unconditionally (this IS the newest phrase by definition).
 * Vault write errors propagate (the enable flow must warn the user - see
 * saveRecoveryPhrase); a failed row publish is only logged, because the next
 * reconcile pass republishes it.
 */
export async function storeRecoveryPhrase(phrase: string): Promise<void> {
  if (!__REBORN_NATIVE__) return;
  const { saveRecoveryPhrase } = await import('./recovery-phrase-vault');
  await saveRecoveryPhrase(phrase);
  try {
    const deps = await nativeDeps();
    await deps.setRowPhrase(await deps.wrap(phrase));
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
  const { setPhraseChangedNotice } = await import('./prefs');
  return {
    loadVaultPhrase: loadRecoveryPhrase,
    saveVaultPhrase: saveRecoveryPhrase,
    getRowPhrase: async () => (await getSettings())?.autoBackupPhrase ?? null,
    // appSettings.update writes IDB, refreshes the store and schedules the
    // debounced synced-settings push - the same path every other setting uses.
    setRowPhrase: (wrapped) =>
      appSettings.update('autoBackupPhrase', {
        wrapped,
        updatedAt: new Date().toISOString()
      }),
    wrap: (phrase) => cryptoManager.encryptText(phrase),
    unwrap: (wrapped) => cryptoManager.decryptText(wrapped),
    notePhraseReplaced: () => setPhraseChangedNotice()
  };
}
