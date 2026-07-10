import { describe, it, expect } from 'vitest';
import {
  SCOPE_SHARED,
  SETTINGS_BUNDLE_SCHEMA_VERSION,
  appScopeFor,
  applyBundlesToSettings,
  extractAppBundle,
  extractSharedBundle,
  migrateAppBundle,
  migrateSharedBundle
} from '../utils/settings-bundle';
import type { AppSettings, PeriodicNotesSettings } from '../stores/settings.store';

const PERIODIC_FIXTURE: PeriodicNotesSettings = {
  daily: { enabled: true, folderId: 'fld-d', format: 'YYYY-MM-DD', onboardingDismissed: true },
  weekly: { enabled: true, folderId: 'fld-w', format: 'YYYY-[W]ww', onboardingDismissed: false },
  monthly: { enabled: false, folderId: null, format: 'YYYY-MM', onboardingDismissed: false }
};

const NOTES_FIXTURE: AppSettings = {
  id: 'idb-row-1',
  app_name: 'reborn-notes',
  theme: 'dark',
  language: 'pl',
  dateFormat: 'DD.MM.YYYY',
  timeFormat: '24h',
  firstDayOfWeek: 1,
  notifications_enabled: true,
  notification_lead_minutes: 30,
  notification_all_day_time: '08:00',
  auto_sync_enabled: true,
  sync_interval_minutes: 10,
  imageLoadMode: 'always',
  editorMode: 'live',
  editorModeIntroSeen: true,
  confirmBeforeDelete: false,
  folderSortMode: 'custom',
  periodicNotes: PERIODIC_FIXTURE,
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-09T10:00:00.000Z'
};

describe('settings-bundle: scope helpers', () => {
  it('SCOPE_SHARED constant', () => {
    expect(SCOPE_SHARED).toBe('shared');
  });

  it('appScopeFor builds the per-app scope string', () => {
    expect(appScopeFor('reborn-task')).toBe('app:reborn-task');
    expect(appScopeFor('reborn-notes')).toBe('app:reborn-notes');
  });
});

describe('settings-bundle: extract', () => {
  it('extractSharedBundle keeps language/dateFormat/timeFormat/firstDayOfWeek and stamps schema_version', () => {
    const shared = extractSharedBundle(NOTES_FIXTURE);
    expect(shared.schema_version).toBe(SETTINGS_BUNDLE_SCHEMA_VERSION);
    expect(shared.language).toBe('pl');
    expect(shared.dateFormat).toBe('DD.MM.YYYY');
    expect(shared.timeFormat).toBe('24h');
    expect(shared.firstDayOfWeek).toBe(1);
  });

  it('extractSharedBundle does NOT include theme (D1: theme is per-app)', () => {
    const shared = extractSharedBundle(NOTES_FIXTURE) as Record<string, unknown>;
    expect('theme' in shared).toBe(false);
  });

  it('extractAppBundle includes theme and per-app keys', () => {
    const app = extractAppBundle(NOTES_FIXTURE);
    expect(app.schema_version).toBe(SETTINGS_BUNDLE_SCHEMA_VERSION);
    expect(app.theme).toBe('dark');
    expect(app.notifications_enabled).toBe(true);
    expect(app.editorMode).toBe('live');
    expect(app.editorModeIntroSeen).toBe(true);
    expect(app.confirmBeforeDelete).toBe(false);
    expect(app.folderSortMode).toBe('custom');
    expect(app.periodicNotes).toEqual(PERIODIC_FIXTURE);
  });

  it('extractAppBundle omits Notes-only keys when undefined (Task case)', () => {
    const taskFixture: AppSettings = { ...NOTES_FIXTURE, app_name: 'reborn-task' };
    delete taskFixture.periodicNotes;
    delete taskFixture.folderSortMode;
    const app = extractAppBundle(taskFixture);
    expect('periodicNotes' in app).toBe(false);
    expect('folderSortMode' in app).toBe(false);
    expect('autoBackupPhrase' in app).toBe(false);
  });

  it('extractAppBundle carries the wrapped auto-backup phrase when present', () => {
    const withPhrase: AppSettings = {
      ...NOTES_FIXTURE,
      autoBackupPhrase: { wrapped: 'aXY=:Y2lwaGVydGV4dA==', updatedAt: '2026-07-10T10:00:00.000Z' }
    };
    const app = extractAppBundle(withPhrase);
    expect(app.autoBackupPhrase).toEqual({
      wrapped: 'aXY=:Y2lwaGVydGV4dA==',
      updatedAt: '2026-07-10T10:00:00.000Z'
    });
  });
});

describe('settings-bundle: applyBundlesToSettings', () => {
  it('applies shared keys without touching app keys', () => {
    const merged = applyBundlesToSettings(
      NOTES_FIXTURE,
      {
        schema_version: 1,
        language: 'de',
        dateFormat: 'YYYY-MM-DD',
        timeFormat: '12h',
        firstDayOfWeek: 0
      },
      null
    );
    expect(merged.language).toBe('de');
    expect(merged.dateFormat).toBe('YYYY-MM-DD');
    expect(merged.timeFormat).toBe('12h');
    expect(merged.firstDayOfWeek).toBe(0);
    expect(merged.theme).toBe('dark');
    expect(merged.editorMode).toBe('live');
  });

  it('applies app keys including theme and periodicNotes', () => {
    const merged = applyBundlesToSettings(NOTES_FIXTURE, null, {
      schema_version: 1,
      theme: 'light',
      editorMode: 'markdown',
      editorModeIntroSeen: false,
      confirmBeforeDelete: true,
      folderSortMode: 'alphabetical',
      periodicNotes: {
        daily: { ...PERIODIC_FIXTURE.daily, enabled: false },
        weekly: PERIODIC_FIXTURE.weekly,
        monthly: PERIODIC_FIXTURE.monthly
      }
    });
    expect(merged.theme).toBe('light');
    expect(merged.editorMode).toBe('markdown');
    expect(merged.editorModeIntroSeen).toBe(false);
    expect(merged.confirmBeforeDelete).toBe(true);
    expect(merged.folderSortMode).toBe('alphabetical');
    expect(merged.periodicNotes?.daily.enabled).toBe(false);
    expect(merged.language).toBe('pl');
  });

  it('undefined keys in a bundle do not overwrite local values (forward-compat)', () => {
    const merged = applyBundlesToSettings(NOTES_FIXTURE, { schema_version: 1 }, { schema_version: 1 });
    expect(merged.language).toBe(NOTES_FIXTURE.language);
    expect(merged.theme).toBe(NOTES_FIXTURE.theme);
    expect(merged.periodicNotes).toEqual(NOTES_FIXTURE.periodicNotes);
  });

  it('round-trip: extract then apply yields the same shared+app fields', () => {
    const baseline: AppSettings = { ...NOTES_FIXTURE };
    const shared = extractSharedBundle(baseline);
    const app = extractAppBundle(baseline);
    const merged = applyBundlesToSettings(
      { ...baseline, language: 'en', theme: 'system', editorMode: 'markdown' },
      shared,
      app
    );
    expect(merged.language).toBe(baseline.language);
    expect(merged.theme).toBe(baseline.theme);
    expect(merged.editorMode).toBe(baseline.editorMode);
  });

  it('round-trip preserves the wrapped auto-backup phrase; absent key leaves local intact', () => {
    const phrase = { wrapped: 'aXY=:Y2lwaGVydGV4dA==', updatedAt: '2026-07-10T10:00:00.000Z' };
    const withPhrase: AppSettings = { ...NOTES_FIXTURE, autoBackupPhrase: phrase };
    const app = extractAppBundle(withPhrase);
    const merged = applyBundlesToSettings(NOTES_FIXTURE, null, app);
    expect(merged.autoBackupPhrase).toEqual(phrase);

    // A bundle WITHOUT the key (older client / settings reset elsewhere) must
    // not clear a locally-known phrase - that device re-publishes from its vault.
    const withoutKey = applyBundlesToSettings(withPhrase, null, { schema_version: 1 });
    expect(withoutKey.autoBackupPhrase).toEqual(phrase);
  });

  it('merges the phrase newest-updatedAt-wins, independent of row-level LWW', () => {
    const older = { wrapped: 'old', updatedAt: '2026-07-01T00:00:00.000Z' };
    const newer = { wrapped: 'new', updatedAt: '2026-07-09T00:00:00.000Z' };

    // Incoming NEWER phrase wins over a local older one...
    const upgraded = applyBundlesToSettings({ ...NOTES_FIXTURE, autoBackupPhrase: older }, null, {
      schema_version: 1,
      autoBackupPhrase: newer
    });
    expect(upgraded.autoBackupPhrase).toEqual(newer);

    // ...but an incoming STALE phrase must never revert a newer local one,
    // even though the surrounding bundle would win row-level LWW - a stale
    // device pushing an unrelated setting must not break recoverability.
    const defended = applyBundlesToSettings({ ...NOTES_FIXTURE, autoBackupPhrase: newer }, null, {
      schema_version: 1,
      theme: 'light',
      autoBackupPhrase: older
    });
    expect(defended.autoBackupPhrase).toEqual(newer);
    expect(defended.theme).toBe('light');

    // A present phrase beats an absent local one regardless of stamps.
    const adopted = applyBundlesToSettings(NOTES_FIXTURE, null, {
      schema_version: 1,
      autoBackupPhrase: older
    });
    expect(adopted.autoBackupPhrase).toEqual(older);
  });
});

describe('settings-bundle: migrate (decrypt → unknown JSON → typed bundle)', () => {
  it('migrateSharedBundle accepts a v1 payload', () => {
    const out = migrateSharedBundle({
      schema_version: 1,
      language: 'fr',
      dateFormat: 'YYYY-MM-DD',
      timeFormat: '24h',
      firstDayOfWeek: 1
    });
    expect(out.language).toBe('fr');
    expect(out.dateFormat).toBe('YYYY-MM-DD');
  });

  it('migrateSharedBundle drops fields with wrong types', () => {
    const out = migrateSharedBundle({
      language: 42,
      dateFormat: { weird: true },
      timeFormat: '24h'
    });
    expect(out.language).toBeUndefined();
    expect(out.dateFormat).toBeUndefined();
    expect(out.timeFormat).toBe('24h');
  });

  it('migrateSharedBundle handles non-object input gracefully', () => {
    expect(migrateSharedBundle(null).schema_version).toBe(1);
    expect(migrateSharedBundle('garbage').schema_version).toBe(1);
  });

  it('migrateAppBundle reads theme + periodicNotes', () => {
    const out = migrateAppBundle({
      schema_version: 1,
      theme: 'dark',
      editorModeIntroSeen: true,
      confirmBeforeDelete: true,
      folderSortMode: 'custom',
      periodicNotes: PERIODIC_FIXTURE
    });
    expect(out.theme).toBe('dark');
    expect(out.editorModeIntroSeen).toBe(true);
    expect(out.confirmBeforeDelete).toBe(true);
    expect(out.folderSortMode).toBe('custom');
    expect(out.periodicNotes).toEqual(PERIODIC_FIXTURE);
  });

  it('migrateAppBundle ignores invalid periodicNotes shape (drops)', () => {
    const out = migrateAppBundle({ periodicNotes: 'not-an-object' });
    expect(out.periodicNotes).toBeUndefined();
  });

  it('migrateAppBundle drops unknown folderSortMode values', () => {
    const out = migrateAppBundle({ folderSortMode: 'by-size' });
    expect(out.folderSortMode).toBeUndefined();
  });

  it('migrateAppBundle reads autoBackupPhrase only with a valid {wrapped, updatedAt} shape', () => {
    const valid = { wrapped: 'aXY=:Y2lwaGVydGV4dA==', updatedAt: '2026-07-10T10:00:00.000Z' };
    expect(migrateAppBundle({ autoBackupPhrase: valid }).autoBackupPhrase).toEqual(valid);
    // Legacy/garbage shapes are dropped: bare string, missing stamp, unparseable stamp.
    expect(migrateAppBundle({ autoBackupPhrase: 'bare-string' }).autoBackupPhrase).toBeUndefined();
    expect(
      migrateAppBundle({ autoBackupPhrase: { wrapped: 'x' } }).autoBackupPhrase
    ).toBeUndefined();
    expect(
      migrateAppBundle({ autoBackupPhrase: { wrapped: 'x', updatedAt: 'not-a-date' } })
        .autoBackupPhrase
    ).toBeUndefined();
  });
});
