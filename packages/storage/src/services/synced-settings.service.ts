/**
 * Client-side service for E2E synced user settings.
 *
 * Responsibilities:
 *   - Pull `/api/settings` after master-key unlock and merge bundles into the
 *     local IndexedDB AppSettings row.
 *   - Push the local AppSettings row to the server (debounced) on every
 *     mutation, splitting the row into shared + per-app bundles.
 *   - Bootstrap: when the server has no row yet for a scope, eagerly upload
 *     the local IndexedDB state (decision D4) so a second device sees the
 *     user's preferences immediately.
 *   - Conflict (HTTP 409): pull the server's current bundle and re-apply
 *     local changes on top.
 *
 * Offline-tolerant: any network failure is logged and swallowed - IndexedDB
 * remains the source of truth for the current session and the next online
 * tick will re-attempt sync.
 */

import { createLogger } from '@reborn/utils';
import { cryptoManager } from '@reborn/crypto';
import { settingsStore, settingsQueries, type AppSettings } from '../stores/settings.store';
import {
  SCOPE_SHARED,
  appScopeFor,
  extractAppBundle,
  extractSharedBundle,
  applyBundlesToSettings,
  migrateAppBundle,
  migrateSharedBundle,
  type AppName,
  type AppSettingsBundle,
  type SharedSettingsBundle
} from '../utils/settings-bundle';

const logger = createLogger('SyncedSettings');

interface BundleWire {
  settings_encrypted: string;
  updated_at: string;
}

interface GetSettingsResponse {
  success: boolean;
  data?: { shared: BundleWire | null; app: BundleWire | null };
  error?: string;
}

interface PutSettingsResponse {
  success: boolean;
  data?: BundleWire;
  error?: string;
  code?: string;
  current?: BundleWire;
}

export interface SyncedSettingsAdapter {
  /** Authenticated fetch wrapper (handles 401 → refresh → retry). */
  authFetch: typeof fetch;
  /** SvelteKit `base` path - passed in to keep the service framework-agnostic. */
  basePath: string;
  /** Which app's IDB row we are reading/writing. */
  appName: AppName;
  /**
   * Optional gate: when it returns false, every server round-trip (pull and
   * push) is a no-op. Used for local-only / no-account mode, where there is no
   * session - without this gate the GET/PUT would 401, trigger a refresh that
   * also 401s, and trip the session-expired banner. Omitted = always enabled.
   */
  isSyncEnabled?: () => boolean;
}

/** How long to wait after the last `update()` before pushing to the server. */
const DEFAULT_DEBOUNCE_MS = 800;

export class SyncedSettingsService {
  private adapter: SyncedSettingsAdapter;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(adapter: SyncedSettingsAdapter) {
    this.adapter = adapter;
  }

  /** Server I/O is disabled (e.g. local-only mode) - every call is a no-op. */
  private syncDisabled(): boolean {
    return this.adapter.isSyncEnabled?.() === false;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Pull the server bundles and merge into local IDB.
   *
   * Behaviour:
   *   - Both bundles missing on server + a local row exists → eager bootstrap
   *     (push local up, server is now in sync).
   *   - Server has a newer bundle than local → server wins (overwrite local
   *     with merged bundle, local `updated_at` advances to server's).
   *   - Local is newer → push up (handled implicitly by the next push).
   */
  async pullAndMerge(): Promise<{ applied: boolean }> {
    if (this.syncDisabled()) return { applied: false };
    if (!cryptoManager.isInitialized()) {
      logger.debug('Master key not initialized - skipping pull');
      return { applied: false };
    }

    let body: GetSettingsResponse;
    try {
      const res = await this.adapter.authFetch(`${this.adapter.basePath}/api/settings`);
      if (!res.ok) {
        logger.warn('Settings pull returned non-OK', { status: res.status });
        return { applied: false };
      }
      body = (await res.json()) as GetSettingsResponse;
    } catch (err) {
      logger.warn('Settings pull failed (network)', err);
      return { applied: false };
    }

    if (!body.success || !body.data) {
      logger.warn('Settings pull returned error body', { error: body.error });
      return { applied: false };
    }

    const { shared, app } = body.data;
    const localSettings = await settingsQueries.getCurrentSettings(this.adapter.appName);

    let sharedBundle: SharedSettingsBundle | null = null;
    let appBundle: AppSettingsBundle | null = null;
    try {
      if (shared) sharedBundle = migrateSharedBundle(JSON.parse(await cryptoManager.decryptText(shared.settings_encrypted)));
      if (app) appBundle = migrateAppBundle(JSON.parse(await cryptoManager.decryptText(app.settings_encrypted)));
    } catch (err) {
      logger.error('Failed to decrypt server bundle - local IDB stays authoritative', err);
      return { applied: false };
    }

    // Bootstrap path: server empty for a scope, but local row exists → push it.
    if (localSettings && (!shared || !app)) {
      if (!shared) {
        await this.pushBundle(SCOPE_SHARED, extractSharedBundle(localSettings), localSettings.updated_at).catch(
          (err) => logger.warn('Bootstrap push (shared) failed', err)
        );
      }
      if (!app) {
        await this.pushBundle(
          appScopeFor(this.adapter.appName),
          extractAppBundle(localSettings),
          localSettings.updated_at
        ).catch((err) => logger.warn('Bootstrap push (app) failed', err));
      }
    }

    if (!sharedBundle && !appBundle) {
      // Nothing on the server. Either we just bootstrapped above, or this is
      // a brand-new account with no IDB row yet - caller's `init()` will run
      // `initializeDefaults()` next and we'll push on first mutation.
      return { applied: false };
    }

    // Compute the server's most recent updated_at across the two scopes.
    const serverUpdated = Math.max(
      shared ? Date.parse(shared.updated_at) : 0,
      app ? Date.parse(app.updated_at) : 0
    );
    const localUpdated = localSettings ? Date.parse(localSettings.updated_at) : 0;

    if (!localSettings) {
      // No local row yet - adopt server bundle as-is. Caller will create the
      // row from defaults if any keys are missing on subsequent flow.
      const seed: AppSettings = {
        id: crypto.randomUUID(),
        app_name: this.adapter.appName,
        theme: 'system',
        language: 'pl',
        dateFormat: 'YYYY-MM-DD',
        timeFormat: '24h',
        firstDayOfWeek: 1,
        notifications_enabled: false,
        notification_lead_minutes: 60,
        notification_all_day_time: '09:00',
        notification_background_delivery: true,
        auto_sync_enabled: true,
        sync_interval_minutes: 5,
        imageLoadMode: 'ask',
        editorMode: 'live',
        editorModeIntroSeen: false,
        created_at: new Date(serverUpdated).toISOString(),
        updated_at: new Date(serverUpdated).toISOString()
      };
      const merged = applyBundlesToSettings(seed, sharedBundle, appBundle);
      merged.updated_at = new Date(serverUpdated).toISOString();
      await settingsStore.save(merged);
      logger.info('Adopted server settings (no local row)');
      return { applied: true };
    }

    if (serverUpdated > localUpdated) {
      const merged = applyBundlesToSettings(localSettings, sharedBundle, appBundle);
      merged.updated_at = new Date(serverUpdated).toISOString();
      await settingsStore.save(merged);
      logger.info('Server settings applied (server newer)', {
        serverUpdated: new Date(serverUpdated).toISOString(),
        localUpdated: new Date(localUpdated).toISOString()
      });
      return { applied: true };
    }

    // localUpdated >= serverUpdated → local wins; defer to push flow.
    return { applied: false };
  }

  /**
   * Schedule a debounced push of the current local AppSettings to the server.
   * Multiple rapid `update()` calls coalesce into a single network round-trip.
   */
  schedulePush(delayMs: number = DEFAULT_DEBOUNCE_MS): void {
    if (this.syncDisabled()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushNow().catch((err) => logger.warn('Debounced push failed', err));
    }, delayMs);
  }

  /** Flush any pending debounced push and execute one immediately. */
  async pushNow(): Promise<void> {
    if (this.syncDisabled()) return;
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        if (!cryptoManager.isInitialized()) return;
        const local = await settingsQueries.getCurrentSettings(this.adapter.appName);
        if (!local) return;

        await Promise.all([
          this.pushBundle(SCOPE_SHARED, extractSharedBundle(local), local.updated_at),
          this.pushBundle(
            appScopeFor(this.adapter.appName),
            extractAppBundle(local),
            local.updated_at
          )
        ]);
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private endpointFor(scope: string): string {
    if (scope === SCOPE_SHARED) return `${this.adapter.basePath}/api/settings/shared`;
    return `${this.adapter.basePath}/api/settings/app`;
  }

  /**
   * Push a single bundle. Handles 409 by pulling the server's current state
   * and re-pushing the merged result (last-write-wins on `updated_at`).
   */
  private async pushBundle(
    scope: string,
    bundle: SharedSettingsBundle | AppSettingsBundle,
    updatedAt: string
  ): Promise<void> {
    const ciphertext = await cryptoManager.encryptText(JSON.stringify(bundle));
    const res = await this.adapter.authFetch(this.endpointFor(scope), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings_encrypted: ciphertext, updated_at: updatedAt })
    });

    if (res.ok) return;

    if (res.status === 409) {
      logger.info('Settings push conflict - pulling and retrying', { scope });
      let conflictBody: PutSettingsResponse;
      try {
        conflictBody = (await res.json()) as PutSettingsResponse;
      } catch {
        return;
      }
      // Bump local updated_at past the server's so the retry wins. Then re-push.
      if (conflictBody.current?.updated_at) {
        const newer = new Date(Date.parse(conflictBody.current.updated_at) + 1).toISOString();
        await this.pushBundle(scope, bundle, newer);
      }
      return;
    }

    // 4xx/5xx → log and drop. The next push or pull will reconcile.
    logger.warn('Settings push returned non-OK', { scope, status: res.status });
  }
}

/**
 * Convenience factory - mirrors how other services in this package are wired.
 */
export function createSyncedSettingsService(adapter: SyncedSettingsAdapter): SyncedSettingsService {
  return new SyncedSettingsService(adapter);
}
