/**
 * Unit tests for the account-scoped recovery-phrase reconcile
 * (`reconcilePhraseCore`). The core takes injected I/O precisely so these
 * rules stay testable: `__REBORN_NATIVE__` is compile-time false under vitest,
 * which makes the real vault/native wrapper dead code here.
 *
 * The rule table under test (row = newest known after pull-merge):
 *   row present, vault empty   → hydrate vault (fresh login / wiped device)
 *   row present, vault differs → replace vault + raise the notice flag
 *   row absent, vault present  → publish wrap(vault) ONLY when allowed
 *     (definitive server view this session / local-only) - "absent locally"
 *     is otherwise indistinguishable from "the pull failed"
 *   row corrupt                → republish from vault (GCM auth failure can't
 *     be a rotation), noop with no vault copy
 */
import { describe, expect, it, vi } from 'vitest';
import { reconcilePhraseCore, type PhraseSyncDeps } from './phrase-sync';

const PHRASE = 'able baker charlie dog easy fox george how item jig king love';
const OTHER = 'mike nan oboe peter queen roger sugar tare uncle victor will xray';

const row = (phrase: string, updatedAt = '2026-07-10T10:00:00.000Z') => ({
  wrapped: `wrapped:${phrase}`,
  updatedAt
});

/** Deps where wrap/unwrap are a trivial reversible encoding. */
function makeDeps(overrides: Partial<PhraseSyncDeps> = {}): PhraseSyncDeps & {
  saveVaultPhrase: ReturnType<typeof vi.fn>;
  setRowPhrase: ReturnType<typeof vi.fn>;
  notePhraseReplaced: ReturnType<typeof vi.fn>;
} {
  return {
    loadVaultPhrase: vi.fn(async () => null),
    saveVaultPhrase: vi.fn(async () => {}),
    getRowPhrase: vi.fn(async () => null),
    setRowPhrase: vi.fn(async () => {}),
    wrap: vi.fn(async (p: string) => `wrapped:${p}`),
    unwrap: vi.fn(async (w: string) => {
      if (!w.startsWith('wrapped:')) throw new Error('auth failure');
      return w.slice('wrapped:'.length);
    }),
    notePhraseReplaced: vi.fn(),
    ...overrides
  } as PhraseSyncDeps & {
    saveVaultPhrase: ReturnType<typeof vi.fn>;
    setRowPhrase: ReturnType<typeof vi.fn>;
    notePhraseReplaced: ReturnType<typeof vi.fn>;
  };
}

const PUBLISH = { allowPublish: true };
const NO_PUBLISH = { allowPublish: false };

describe('reconcilePhraseCore', () => {
  it('hydrates an empty vault from the synced row (fresh device / after logout)', async () => {
    const deps = makeDeps({ getRowPhrase: async () => row(PHRASE) });
    await expect(reconcilePhraseCore(deps, NO_PUBLISH)).resolves.toBe('hydrated-vault');
    expect(deps.saveVaultPhrase).toHaveBeenCalledWith(PHRASE);
    expect(deps.setRowPhrase).not.toHaveBeenCalled();
    expect(deps.notePhraseReplaced).not.toHaveBeenCalled();
  });

  it('replaces a differing vault copy AND raises the notice flag (rotation elsewhere)', async () => {
    const deps = makeDeps({
      loadVaultPhrase: async () => OTHER,
      getRowPhrase: async () => row(PHRASE)
    });
    await expect(reconcilePhraseCore(deps, NO_PUBLISH)).resolves.toBe('replaced-vault');
    expect(deps.saveVaultPhrase).toHaveBeenCalledWith(PHRASE);
    expect(deps.notePhraseReplaced).toHaveBeenCalledOnce();
  });

  it('publishes the vault phrase when the row has none and publishing is allowed', async () => {
    const deps = makeDeps({ loadVaultPhrase: async () => PHRASE });
    await expect(reconcilePhraseCore(deps, PUBLISH)).resolves.toBe('published-row');
    expect(deps.setRowPhrase).toHaveBeenCalledWith(`wrapped:${PHRASE}`);
    expect(deps.saveVaultPhrase).not.toHaveBeenCalled();
  });

  it('does NOT publish without a definitive server view (failed pull must not clobber the account)', async () => {
    const deps = makeDeps({ loadVaultPhrase: async () => PHRASE });
    await expect(reconcilePhraseCore(deps, NO_PUBLISH)).resolves.toBe('noop');
    expect(deps.setRowPhrase).not.toHaveBeenCalled();
  });

  it('republishes over an undecryptable row value when the vault knows the phrase', async () => {
    const deps = makeDeps({
      loadVaultPhrase: async () => PHRASE,
      getRowPhrase: async () => ({ wrapped: 'garbage-not-wrapped', updatedAt: '2026-07-10T10:00:00.000Z' })
    });
    await expect(reconcilePhraseCore(deps, NO_PUBLISH)).resolves.toBe('republished-row');
    expect(deps.setRowPhrase).toHaveBeenCalledWith(`wrapped:${PHRASE}`);
  });

  it('leaves an undecryptable row alone when this device has no vault copy', async () => {
    const deps = makeDeps({
      getRowPhrase: async () => ({ wrapped: 'garbage-not-wrapped', updatedAt: '2026-07-10T10:00:00.000Z' })
    });
    await expect(reconcilePhraseCore(deps, PUBLISH)).resolves.toBe('noop');
    expect(deps.setRowPhrase).not.toHaveBeenCalled();
    expect(deps.saveVaultPhrase).not.toHaveBeenCalled();
  });

  it('noops when row and vault already agree', async () => {
    const deps = makeDeps({
      loadVaultPhrase: async () => PHRASE,
      getRowPhrase: async () => row(PHRASE)
    });
    await expect(reconcilePhraseCore(deps, PUBLISH)).resolves.toBe('noop');
    expect(deps.saveVaultPhrase).not.toHaveBeenCalled();
    expect(deps.setRowPhrase).not.toHaveBeenCalled();
    expect(deps.notePhraseReplaced).not.toHaveBeenCalled();
  });

  it('noops when neither side has a phrase', async () => {
    const deps = makeDeps();
    await expect(reconcilePhraseCore(deps, PUBLISH)).resolves.toBe('noop');
  });
});
