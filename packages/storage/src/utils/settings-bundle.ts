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
  firstDayOfWeek?: AppSettings['firstDayOfWeek'];
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
  periodicNotes?: AppSettings['periodicNotes'];
}

/** Extract the shared subset of an AppSettings row. */
export function extractSharedBundle(s: AppSettings): SharedSettingsBundle {
  return {
    schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
    language: s.language,
    dateFormat: s.dateFormat,
    timeFormat: s.timeFormat,
    firstDayOfWeek: s.firstDayOfWeek
  };
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
  if (s.periodicNotes !== undefined) {
    bundle.periodicNotes = s.periodicNotes;
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
    if (app.periodicNotes !== undefined) merged.periodicNotes = app.periodicNotes;
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
    ...(typeof obj.firstDayOfWeek === 'number' ? { firstDayOfWeek: obj.firstDayOfWeek } : {})
  };
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
  if (typeof obj.periodicNotes === 'object' && obj.periodicNotes !== null) {
    out.periodicNotes = obj.periodicNotes as AppSettings['periodicNotes'];
  }
  return out;
}
