/**
 * E2E synced user settings - bundle split / combine helpers.
 *
 * Three logical bundles flow between client and server:
 *   - 'shared'           - cross-app keys (language, dateFormat, …)
 *   - 'app:reborn-task'  - Task-only keys (theme, notifications, …)
 *   - 'app:reborn-notes' - Notes-only keys (theme, editor mode, periodic notes, …)
 *
 * `theme` lives in the per-app bundle (decision D1: per-app theme - user can
 * keep dark Task and light Notes if desired). Behavioural Notes-only keys
 * (`imageLoadMode`, `editorMode`, `editorModeIntroSeen`, `periodicNotes`) only
 * appear in the Notes bundle but the type allows them in the Task bundle as
 * well so a single client can ignore unknown keys gracefully (decision D6).
 *
 * Schema version lives inside each JSON bundle (decision D5) - bumping the
 * shape never requires a DB migration server-side.
 */

import type { AppSettings } from '../stores/settings.store';

export const SETTINGS_BUNDLE_SCHEMA_VERSION = 1 as const;

export type AppName = AppSettings['app_name'];
export type AppBundleScope = `app:${AppName}`;
export const SCOPE_SHARED = 'shared' as const;

export const appScopeFor = (app: AppName): AppBundleScope => `app:${app}`;

/**
 * Cross-app shared bundle - same values applied in both Task and Notes.
 *
 * `theme` is intentionally NOT here - it lives per-app (D1).
 */
export interface SharedSettingsBundle {
  schema_version: typeof SETTINGS_BUNDLE_SCHEMA_VERSION;
  language?: AppSettings['language'];
  dateFormat?: AppSettings['dateFormat'];
  timeFormat?: AppSettings['timeFormat'];
  /** @deprecated See `AppSettings.firstDayOfWeek`; carried for older clients. */
  firstDayOfWeek?: AppSettings['firstDayOfWeek'];
  /**
   * First day of the week (#493). Absent until the user picks an option.
   * An older client drops it from the bundle it pushes; the merge below then
   * keeps the local value, so only a device that never saw the choice falls
   * back to 'auto'.
   */
  weekStart?: AppSettings['weekStart'];
}

/**
 * Per-app bundle - synced cross-device but not shared between apps.
 *
 * Notes-only keys are `optional` everywhere; a Task client receiving a Notes
 * bundle (shouldn't happen - server scope-checks) would simply ignore them.
 */
export interface AppSettingsBundle {
  schema_version: typeof SETTINGS_BUNDLE_SCHEMA_VERSION;
  theme?: AppSettings['theme'];
  notifications_enabled?: AppSettings['notifications_enabled'];
  notification_lead_minutes?: AppSettings['notification_lead_minutes'];
  notification_all_day_time?: AppSettings['notification_all_day_time'];
  notification_background_delivery?: AppSettings['notification_background_delivery'];
  auto_sync_enabled?: AppSettings['auto_sync_enabled'];
  sync_interval_minutes?: AppSettings['sync_interval_minutes'];
  imageLoadMode?: AppSettings['imageLoadMode'];
  editorMode?: AppSettings['editorMode'];
  editorModeIntroSeen?: AppSettings['editorModeIntroSeen'];
  confirmBeforeDelete?: AppSettings['confirmBeforeDelete'];
  folderSortMode?: AppSettings['folderSortMode'];
  /** Notes-only (#522): `null` travels too, so clearing the choice syncs. */
  newNoteFolderId?: AppSettings['newNoteFolderId'];
  periodicNotes?: AppSettings['periodicNotes'];
  /**
   * Notes-only: recovery phrase wrapped as its own ciphertext under the master
   * key (never plaintext - see the AppSettings field doc). Riding the app
   * bundle makes it account-scoped without any server-side change: the server
   * stores it doubly encrypted inside `settings_encrypted`. Merged
   * newest-`updatedAt`-wins (see applyBundlesToSettings), NOT row-level LWW.
   */
  autoBackupPhrase?: AppSettings['autoBackupPhrase'];
}

/** Extract the shared subset of an AppSettings row. */
export function extractSharedBundle(s: AppSettings): SharedSettingsBundle {
  const bundle: SharedSettingsBundle = {
    schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
    language: s.language,
    dateFormat: s.dateFormat,
    timeFormat: s.timeFormat,
    firstDayOfWeek: s.firstDayOfWeek
  };
  // Left out while absent: a device that never saw a choice must not
  // overwrite the day picked on another one.
  if (s.weekStart !== undefined) {
    bundle.weekStart = s.weekStart;
  }
  return bundle;
}

/** Extract the per-app subset of an AppSettings row. */
export function extractAppBundle(s: AppSettings): AppSettingsBundle {
  const bundle: AppSettingsBundle = {
    schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
    theme: s.theme,
    notifications_enabled: s.notifications_enabled,
    notification_lead_minutes: s.notification_lead_minutes,
    notification_all_day_time: s.notification_all_day_time,
    notification_background_delivery: s.notification_background_delivery,
    auto_sync_enabled: s.auto_sync_enabled,
    sync_interval_minutes: s.sync_interval_minutes,
    imageLoadMode: s.imageLoadMode,
    editorMode: s.editorMode,
    editorModeIntroSeen: s.editorModeIntroSeen,
    confirmBeforeDelete: s.confirmBeforeDelete
  };
  if (s.folderSortMode !== undefined) {
    bundle.folderSortMode = s.folderSortMode;
  }
  if (s.newNoteFolderId !== undefined) {
    bundle.newNoteFolderId = s.newNoteFolderId;
  }
  if (s.periodicNotes !== undefined) {
    bundle.periodicNotes = s.periodicNotes;
  }
  if (s.autoBackupPhrase !== undefined) {
    bundle.autoBackupPhrase = s.autoBackupPhrase;
  }
  return bundle;
}

/**
 * Apply server bundles onto a local AppSettings row. Missing keys in a bundle
 * are left untouched (forward-compat: an older client wrote a bundle without
 * a key the newer client knows about → keep the local default).
 */
export function applyBundlesToSettings(
  current: AppSettings,
  shared: SharedSettingsBundle | null,
  app: AppSettingsBundle | null
): AppSettings {
  const merged: AppSettings = { ...current };
  if (shared) {
    if (shared.language !== undefined) merged.language = shared.language;
    if (shared.dateFormat !== undefined) merged.dateFormat = shared.dateFormat;
    if (shared.timeFormat !== undefined) merged.timeFormat = shared.timeFormat;
    if (shared.firstDayOfWeek !== undefined) merged.firstDayOfWeek = shared.firstDayOfWeek;
    if (shared.weekStart !== undefined) merged.weekStart = shared.weekStart;
  }
  if (app) {
    if (app.theme !== undefined) merged.theme = app.theme;
    if (app.notifications_enabled !== undefined) merged.notifications_enabled = app.notifications_enabled;
    if (app.notification_lead_minutes !== undefined) merged.notification_lead_minutes = app.notification_lead_minutes;
    if (app.notification_all_day_time !== undefined) merged.notification_all_day_time = app.notification_all_day_time;
    if (app.notification_background_delivery !== undefined) merged.notification_background_delivery = app.notification_background_delivery;
    if (app.auto_sync_enabled !== undefined) merged.auto_sync_enabled = app.auto_sync_enabled;
    if (app.sync_interval_minutes !== undefined) merged.sync_interval_minutes = app.sync_interval_minutes;
    if (app.imageLoadMode !== undefined) merged.imageLoadMode = app.imageLoadMode;
    if (app.editorMode !== undefined) merged.editorMode = app.editorMode;
    if (app.editorModeIntroSeen !== undefined) merged.editorModeIntroSeen = app.editorModeIntroSeen;
    if (app.confirmBeforeDelete !== undefined) merged.confirmBeforeDelete = app.confirmBeforeDelete;
    if (app.folderSortMode !== undefined) merged.folderSortMode = app.folderSortMode;
    if (app.newNoteFolderId !== undefined) merged.newNoteFolderId = app.newNoteFolderId;
    if (app.periodicNotes !== undefined) merged.periodicNotes = app.periodicNotes;
    if (app.autoBackupPhrase !== undefined) {
      // Newest-wins on the field's OWN stamp, independent of the row's
      // updated_at: whole-row LWW must never let a stale device's unrelated
      // settings push revert the account's newest recovery phrase - that
      // would silently make every backup taken since undecryptable with the
      // phrase the user actually wrote down.
      const local = merged.autoBackupPhrase;
      if (!local || Date.parse(app.autoBackupPhrase.updatedAt) > Date.parse(local.updatedAt)) {
        merged.autoBackupPhrase = app.autoBackupPhrase;
      }
    }
  }
  return merged;
}

/**
 * Coerce an unknown JSON payload (post-decrypt) into a SharedSettingsBundle.
 * Any future schema migrations live here.
 *
 * Currently accepts anything shaped like `{ schema_version: 1, … }` or with
 * no schema_version (treated as v1 for forward-compat with legacy bundles).
 */
export function migrateSharedBundle(raw: unknown): SharedSettingsBundle {
  if (typeof raw !== 'object' || raw === null) {
    return { schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION };
  }
  const obj = raw as Record<string, unknown>;
  return {
    schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
    ...(typeof obj.language === 'string' ? { language: obj.language as SharedSettingsBundle['language'] } : {}),
    ...(typeof obj.dateFormat === 'string' ? { dateFormat: obj.dateFormat } : {}),
    ...(typeof obj.timeFormat === 'string' ? { timeFormat: obj.timeFormat as SharedSettingsBundle['timeFormat'] } : {}),
    ...(typeof obj.firstDayOfWeek === 'number' ? { firstDayOfWeek: obj.firstDayOfWeek } : {}),
    // Only the values this build offers; anything else (a day a newer client
    // added) is dropped, which keeps the local value instead of breaking it.
    ...(isWeekStart(obj.weekStart) ? { weekStart: obj.weekStart } : {})
  };
}

/** Mirrors `isWeekStartPreference` in @reborn/i18n (no dependency from here). */
function isWeekStart(value: unknown): value is NonNullable<AppSettings['weekStart']> {
  return value === 'auto' || value === 0 || value === 1 || value === 6;
}

/** Same forward-compat reader for the per-app bundle. */
export function migrateAppBundle(raw: unknown): AppSettingsBundle {
  if (typeof raw !== 'object' || raw === null) {
    return { schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION };
  }
  const obj = raw as Record<string, unknown>;
  const out: AppSettingsBundle = { schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION };
  if (typeof obj.theme === 'string') out.theme = obj.theme as AppSettings['theme'];
  if (typeof obj.notifications_enabled === 'boolean') out.notifications_enabled = obj.notifications_enabled;
  if (typeof obj.notification_lead_minutes === 'number') out.notification_lead_minutes = obj.notification_lead_minutes;
  if (typeof obj.notification_all_day_time === 'string') out.notification_all_day_time = obj.notification_all_day_time;
  if (typeof obj.notification_background_delivery === 'boolean') out.notification_background_delivery = obj.notification_background_delivery;
  if (typeof obj.auto_sync_enabled === 'boolean') out.auto_sync_enabled = obj.auto_sync_enabled;
  if (typeof obj.sync_interval_minutes === 'number') out.sync_interval_minutes = obj.sync_interval_minutes;
  if (typeof obj.imageLoadMode === 'string') out.imageLoadMode = obj.imageLoadMode as AppSettings['imageLoadMode'];
  if (typeof obj.editorMode === 'string') out.editorMode = obj.editorMode as AppSettings['editorMode'];
  if (typeof obj.editorModeIntroSeen === 'boolean') out.editorModeIntroSeen = obj.editorModeIntroSeen;
  if (typeof obj.confirmBeforeDelete === 'boolean') out.confirmBeforeDelete = obj.confirmBeforeDelete;
  if (obj.folderSortMode === 'alphabetical' || obj.folderSortMode === 'custom') {
    out.folderSortMode = obj.folderSortMode;
  }
  if (obj.newNoteFolderId === null || (typeof obj.newNoteFolderId === 'string' && obj.newNoteFolderId !== '')) {
    out.newNoteFolderId = obj.newNoteFolderId;
  }
  if (typeof obj.periodicNotes === 'object' && obj.periodicNotes !== null) {
    out.periodicNotes = obj.periodicNotes as AppSettings['periodicNotes'];
  }
  if (typeof obj.autoBackupPhrase === 'object' && obj.autoBackupPhrase !== null) {
    const phrase = obj.autoBackupPhrase as Record<string, unknown>;
    if (
      typeof phrase.wrapped === 'string' &&
      typeof phrase.updatedAt === 'string' &&
      !Number.isNaN(Date.parse(phrase.updatedAt))
    ) {
      out.autoBackupPhrase = { wrapped: phrase.wrapped, updatedAt: phrase.updatedAt };
    }
  }
  return out;
}
