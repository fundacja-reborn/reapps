// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression cover for the per-app "What's new" baseline.
 *
 * The bug: Task and Notes shared one localStorage key on the same origin, so
 * whichever app loaded first advanced the baseline and suppressed the other
 * app's dialog - even though release notes are filtered per app. The fix scopes
 * the key per app and migrates the legacy shared key. These tests pin down the
 * migration, the cross-app-safe cleanup (legacy kept until BOTH apps own a
 * baseline), and the unchanged new-user / no-content / already-seen behaviour.
 *
 * i18n is mocked: a local compareVersions (trivial, separately tested in the
 * package) keeps the test deterministic and off the live manifest, while
 * hasUnseenReleaseNotes is a spy so each test controls "does this app have
 * content in the gap".
 */

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/stores/whats-new.svelte', () => ({ openWhatsNew: vi.fn() }));
vi.mock('@reborn/utils', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));
vi.mock('@reborn/i18n', () => ({
  // Mirror of the package's pure x.y.z compare - kept inline so the service test
  // depends on neither the built package nor the live release manifest.
  compareVersions: (a: string, b: string) => {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  },
  hasUnseenReleaseNotes: vi.fn()
}));

const LEGACY_KEY = 'whats_new_last_seen';
const NOTES_KEY = 'whats_new_last_seen_notes';
const TASK_KEY = 'whats_new_last_seen_task';
const CURRENT = '0.38.0';
const PREVIOUS = '0.37.0';

// Re-import per test: the module's `shown` latch and the per-app key resolution
// must start fresh each time.
async function load() {
  const svc = await import('./whats-new.service');
  const i18n = await import('@reborn/i18n');
  const store = await import('$lib/stores/whats-new.svelte');
  return {
    maybeShowWhatsNew: svc.maybeShowWhatsNew,
    hasUnseen: vi.mocked(i18n.hasUnseenReleaseNotes),
    openWhatsNew: vi.mocked(store.openWhatsNew)
  };
}

describe('maybeShowWhatsNew - per-app baseline', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('__APP_VERSION__', CURRENT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('new user (no baseline at all): records a silent baseline, no dialog', async () => {
    const { maybeShowWhatsNew, openWhatsNew } = await load();

    maybeShowWhatsNew('notes', 'web');

    expect(openWhatsNew).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTES_KEY)).toBe(CURRENT);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('migrates the legacy shared key so the fix release still opens the dialog', async () => {
    localStorage.setItem(LEGACY_KEY, PREVIOUS);
    const { maybeShowWhatsNew, openWhatsNew, hasUnseen } = await load();
    hasUnseen.mockReturnValue(true);

    maybeShowWhatsNew('notes', 'web');

    expect(hasUnseen).toHaveBeenCalledWith({
      app: 'notes',
      platform: 'web',
      lastSeenVersion: PREVIOUS,
      currentVersion: CURRENT
    });
    expect(openWhatsNew).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(NOTES_KEY)).toBe(CURRENT);
  });

  it('keeps the legacy key until the other app has migrated too', async () => {
    localStorage.setItem(LEGACY_KEY, PREVIOUS); // task has NOT migrated yet
    const { maybeShowWhatsNew, hasUnseen } = await load();
    hasUnseen.mockReturnValue(true);

    maybeShowWhatsNew('notes', 'web');

    // Task still needs the legacy value to migrate, so it must survive.
    expect(localStorage.getItem(LEGACY_KEY)).toBe(PREVIOUS);
    expect(localStorage.getItem(NOTES_KEY)).toBe(CURRENT);
  });

  it('drops the legacy key once both apps own a baseline', async () => {
    localStorage.setItem(LEGACY_KEY, PREVIOUS);
    localStorage.setItem(TASK_KEY, CURRENT); // task already migrated
    const { maybeShowWhatsNew, hasUnseen } = await load();
    hasUnseen.mockReturnValue(true);

    maybeShowWhatsNew('notes', 'web');

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(NOTES_KEY)).toBe(CURRENT);
    expect(localStorage.getItem(TASK_KEY)).toBe(CURRENT);
  });

  it('no content for this app in the gap: advances baseline silently, no dialog', async () => {
    localStorage.setItem(LEGACY_KEY, PREVIOUS);
    const { maybeShowWhatsNew, openWhatsNew, hasUnseen } = await load();
    hasUnseen.mockReturnValue(false);

    maybeShowWhatsNew('notes', 'web');

    expect(openWhatsNew).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTES_KEY)).toBe(CURRENT);
  });

  it('already up to date: no dialog, no version check, baseline unchanged', async () => {
    localStorage.setItem(NOTES_KEY, CURRENT);
    const { maybeShowWhatsNew, openWhatsNew, hasUnseen } = await load();

    maybeShowWhatsNew('notes', 'web');

    expect(openWhatsNew).not.toHaveBeenCalled();
    expect(hasUnseen).not.toHaveBeenCalled();
    expect(localStorage.getItem(NOTES_KEY)).toBe(CURRENT);
  });
});
