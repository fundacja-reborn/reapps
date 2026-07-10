/**
 * Unit tests for the account-scoped recovery-phrase reconcile
 * (`reconcilePhraseCore`). The core takes injected I/O precisely so these
 * rules stay testable: `__REBORN_NATIVE__` is compile-time false under vitest,
 * which makes the real vault/native wrapper dead code here.
 *
 * The rule table under test (row = synced truth, vault = device copy):
 *   row present & differs  → hydrate vault (fresh login / remote rotation)
 *   row absent & vault set → publish wrapped copy (pre-scoping migration)
 *   row corrupt & vault set→ republish (GCM auth failure can't be a rotation)
 *   otherwise              → noop
 */
import { describe, expect, it, vi } from 'vitest';
import { reconcilePhraseCore, type PhraseSyncDeps } from './phrase-sync';

const PHRASE = 'able baker charlie dog easy fox george how item jig king love';
const OTHER = 'mike nan oboe peter queen roger sugar tare uncle victor will xray';

/** Deps where wrap/unwrap are a trivial reversible encoding. */
function makeDeps(overrides: Partial<PhraseSyncDeps> = {}): PhraseSyncDeps & {
  saveVaultPhrase: ReturnType<typeof vi.fn>;
  setWrappedInRow: ReturnType<typeof vi.fn>;
} {
  return {
    loadVaultPhrase: vi.fn(async () => null),
    saveVaultPhrase: vi.fn(async () => {}),
    getWrappedFromRow: vi.fn(async () => null),
    setWrappedInRow: vi.fn(async () => {}),
    wrap: vi.fn(async (p: string) => `wrapped:${p}`),
    unwrap: vi.fn(async (w: string) => {
      if (!w.startsWith('wrapped:')) throw new Error('auth failure');
      return w.slice('wrapped:'.length);
    }),
    ...overrides
  } as PhraseSyncDeps & {
    saveVaultPhrase: ReturnType<typeof vi.fn>;
    setWrappedInRow: ReturnType<typeof vi.fn>;
  };
}

describe('reconcilePhraseCore', () => {
  it('hydrates an empty vault from the synced row (fresh device / after logout)', async () => {
    const deps = makeDeps({ getWrappedFromRow: async () => `wrapped:${PHRASE}` });
    await expect(reconcilePhraseCore(deps)).resolves.toBe('hydrated-vault');
    expect(deps.saveVaultPhrase).toHaveBeenCalledWith(PHRASE);
    expect(deps.setWrappedInRow).not.toHaveBeenCalled();
  });

  it('overwrites a stale vault copy when the row differs (rotation on another device)', async () => {
    const deps = makeDeps({
      loadVaultPhrase: async () => OTHER,
      getWrappedFromRow: async () => `wrapped:${PHRASE}`
    });
    await expect(reconcilePhraseCore(deps)).resolves.toBe('hydrated-vault');
    expect(deps.saveVaultPhrase).toHaveBeenCalledWith(PHRASE);
  });

  it('publishes the vault phrase when the row has none (pre-scoping install migration)', async () => {
    const deps = makeDeps({ loadVaultPhrase: async () => PHRASE });
    await expect(reconcilePhraseCore(deps)).resolves.toBe('published-row');
    expect(deps.setWrappedInRow).toHaveBeenCalledWith(`wrapped:${PHRASE}`);
    expect(deps.saveVaultPhrase).not.toHaveBeenCalled();
  });

  it('republishes over an undecryptable row value when the vault knows the phrase', async () => {
    const deps = makeDeps({
      loadVaultPhrase: async () => PHRASE,
      getWrappedFromRow: async () => 'garbage-not-wrapped'
    });
    await expect(reconcilePhraseCore(deps)).resolves.toBe('republished-row');
    expect(deps.setWrappedInRow).toHaveBeenCalledWith(`wrapped:${PHRASE}`);
  });

  it('leaves an undecryptable row alone when this device has no vault copy', async () => {
    const deps = makeDeps({ getWrappedFromRow: async () => 'garbage-not-wrapped' });
    await expect(reconcilePhraseCore(deps)).resolves.toBe('noop');
    expect(deps.setWrappedInRow).not.toHaveBeenCalled();
    expect(deps.saveVaultPhrase).not.toHaveBeenCalled();
  });

  it('noops when row and vault already agree', async () => {
    const deps = makeDeps({
      loadVaultPhrase: async () => PHRASE,
      getWrappedFromRow: async () => `wrapped:${PHRASE}`
    });
    await expect(reconcilePhraseCore(deps)).resolves.toBe('noop');
    expect(deps.saveVaultPhrase).not.toHaveBeenCalled();
    expect(deps.setWrappedInRow).not.toHaveBeenCalled();
  });

  it('noops when neither side has a phrase', async () => {
    const deps = makeDeps();
    await expect(reconcilePhraseCore(deps)).resolves.toBe('noop');
  });
});
