import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { API_BASE } from '$lib/utils/api-base';
import { getShareBase } from '$lib/utils/share-base';
import { authFetch } from '$lib/utils/auth-fetch';
import { connectivityStore } from '$lib/stores/connectivity.store';
import { sessionExpired, localOnly } from '$lib/stores/sync-status.store';
import { refreshQuota } from '$lib/stores/storage-quota.store';
import {
  cryptoManager,
  buildShareUrl,
  importKeyFromBase64url,
  decryptSnapshotPayload
} from '@reborn/crypto';
import {
  SNAPSHOT_PAYLOAD_VERSION,
  SharedSnapshotPayloadSchema,
  type OwnShareListItem,
  type SharedSnapshotNotePayload
} from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-SharesStore');

/**
 * Currently selected share in the Shares master-detail view (null = none).
 * Mirrors `activeNoteId` in notes.store: the sidebar list writes it, the main
 * detail pane reads it. Cleared on crypto lock/reset so a stale selection never
 * outlives the decrypted payloads it points at.
 */
export const activeShareId = writable<string | null>(null);

export type DecodedNoteShare = {
  payload: SharedSnapshotNotePayload;
  url: string;
};

export type SharesState = {
  loading: boolean;
  shares: OwnShareListItem[];
  decoded: Record<string, DecodedNoteShare>;
  decryptErrors: Set<string>;
  error: string | null;
  /** Last successful fetch (epoch ms). null = never loaded. */
  lastFetchedAt: number | null;
};

const initialState: SharesState = {
  loading: false,
  shares: [],
  decoded: {},
  decryptErrors: new Set(),
  error: null,
  lastFetchedAt: null
};

function isExhausted(s: OwnShareListItem): boolean {
  return s.max_access_count !== null && s.access_count >= s.max_access_count;
}

function isInactive(s: OwnShareListItem): boolean {
  if (s.revoked_at) return true;
  if (s.expires_at && new Date(s.expires_at) < new Date()) return true;
  return isExhausted(s);
}

function createSharesStore() {
  const state = writable<SharesState>(initialState);
  let initialized = false;

  async function hydrate(items: OwnShareListItem[]): Promise<{
    decoded: Record<string, DecodedNoteShare>;
    decryptErrors: Set<string>;
  }> {
    const nextDecoded: Record<string, DecodedNoteShare> = {};
    const nextErrors = new Set<string>();
    if (!cryptoManager.isInitialized()) return { decoded: nextDecoded, decryptErrors: nextErrors };
    const shareBase = getShareBase();
    await Promise.all(
      items.map(async (s) => {
        let rawKey: string;
        try {
          rawKey = await cryptoManager.decryptString(s.owner_key_wrapped);
        } catch (err) {
          logger.warn('Failed to unwrap share key:', err);
          nextErrors.add(s.id);
          return;
        }
        const url = buildShareUrl(shareBase, s.slug, rawKey, SNAPSHOT_PAYLOAD_VERSION);
        try {
          const key = await importKeyFromBase64url(rawKey);
          const plaintext = await decryptSnapshotPayload(s.payload_encrypted, key);
          const parsed = SharedSnapshotPayloadSchema.safeParse(plaintext);
          if (!parsed.success || parsed.data.type !== 'note') {
            nextErrors.add(s.id);
            return;
          }
          nextDecoded[s.id] = { payload: parsed.data, url };
        } catch (err) {
          logger.warn('Failed to decrypt share payload:', err);
          nextErrors.add(s.id);
        }
      })
    );
    return { decoded: nextDecoded, decryptErrors: nextErrors };
  }

  async function refresh(): Promise<void> {
    if (!browser) return;
    // Sharing is account-only. In local-only mode there is no server session,
    // so hitting /api/shares would 401, authFetch's refresh would 401 too, and
    // onSessionExpired would raise a false "session expired" banner. Skip it -
    // mirrors the synced-settings !localOnly gate (see guideline 65).
    if (get(localOnly)) {
      state.update((s) => ({ ...s, loading: false }));
      return;
    }
    if (!cryptoManager.isInitialized()) {
      state.update((s) => ({ ...s, loading: false }));
      return;
    }
    state.update((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await authFetch(`${API_BASE}/shares`);
      // Guard before parsing: a non-2xx (proxy error page, rate limit) is not
      // guaranteed to be JSON - res.json() would throw a parse error and mask
      // the real failure (Faza 1 follow-up, hardened in Faza 5).
      if (!res.ok) {
        state.update((s) => ({ ...s, loading: false, error: 'load_failed' }));
        return;
      }
      const data = await res.json();
      if (!data.success) {
        state.update((s) => ({ ...s, loading: false, error: 'load_failed' }));
        return;
      }
      const shares = data.data.shares as OwnShareListItem[];
      const { decoded, decryptErrors } = await hydrate(shares);
      state.set({
        loading: false,
        shares,
        decoded,
        decryptErrors,
        error: null,
        lastFetchedAt: Date.now()
      });
      // Active shares count toward storage quota - keep the settings UI and
      // header badges in sync without waiting for the next sync cycle.
      void refreshQuota();
    } catch (err: unknown) {
      logger.error('Fetch shares failed:', err);
      state.update((s) => ({ ...s, loading: false, error: 'load_failed' }));
    }
  }

  async function revoke(slug: string): Promise<boolean> {
    if (!browser) return false;
    try {
      const res = await authFetch(`${API_BASE}/shares/${slug}`, { method: 'DELETE' });
      if (!res.ok) return false;
      const now = new Date().toISOString();
      state.update((s) => ({
        ...s,
        shares: s.shares.map((sh) => (sh.slug === slug ? { ...sh, revoked_at: now } : sh))
      }));
      // Revoke frees quota immediately (server filters revoked_at IS NULL).
      void refreshQuota();
      return true;
    } catch (err: unknown) {
      logger.error('Revoke failed:', err);
      return false;
    }
  }

  function reset() {
    state.set({ ...initialState, decryptErrors: new Set(), decoded: {}, shares: [] });
    activeShareId.set(null);
  }

  function init() {
    if (initialized || !browser) return;
    initialized = true;
    // Initial load if crypto already unlocked at init time.
    if (cryptoManager.isInitialized()) {
      void refresh();
    }
    // React to lock/unlock so the badge/icon stays in sync.
    cryptoManager.subscribeToKeyEvents((event) => {
      if (event === 'unlocked') {
        void refresh();
      } else {
        reset();
      }
    });
    // Auto-refresh when we come back online after a failed load. The
    // connectivity store probes /api/health, so an offline → online
    // transition is a real signal that the next API call should succeed.
    if (connectivityStore) {
      let prevStatus = connectivityStore.getState().status;
      connectivityStore.subscribe((conn) => {
        if (
          conn.status === 'online'
          && prevStatus !== 'online'
          && cryptoManager.isInitialized()
          && get(state).error !== null
        ) {
          void refresh();
        }
        prevStatus = conn.status;
      });
    }
    // Auto-refresh when the session is re-established after expiry. Without
    // this, a ManageSharesDialog opened during expiry keeps showing the stale
    // "Couldn't refresh" banner even though the user has signed in again.
    let prevExpired = get(sessionExpired);
    sessionExpired.subscribe((expired) => {
      if (
        prevExpired === true
        && expired === false
        && cryptoManager.isInitialized()
      ) {
        void refresh();
      }
      prevExpired = expired;
    });
  }

  return {
    subscribe: state.subscribe,
    init,
    refresh,
    revoke,
    reset,
    /** Synchronous snapshot - useful for one-shot lookups outside reactive contexts. */
    snapshot: () => get(state)
  };
}

export const sharesStore = createSharesStore();

/** Active = not revoked, not expired, not exhausted. */
export const activeShares = derived(sharesStore, ($s) => {
  return $s.shares.filter((sh) => {
    if (isInactive(sh)) return false;
    // Defense-in-depth: only count rows whose decrypted payload is actually a note.
    if (sh.snapshot_type === 'note') return true;
    if (sh.snapshot_type === 'unknown') {
      return $s.decoded[sh.id]?.payload.type === 'note';
    }
    return false;
  });
});

/** Number of active shares (Notes-scope only). Drives IconNav badge. */
export const activeSharesCount = derived(activeShares, ($s) => $s.length);

/**
 * Map: source_id (note UUID) → list of active shares created from that note.
 * Shares without a `source_id` in their payload (legacy / pre-source_id) are
 * absent from this map and never trigger the per-note badge.
 */
export const sharesBySourceId = derived(
  [sharesStore, activeShares],
  ([$state, $active]) => {
    const map = new Map<string, OwnShareListItem[]>();
    for (const share of $active) {
      const sourceId = $state.decoded[share.id]?.payload.source_id;
      if (!sourceId) continue;
      const list = map.get(sourceId) ?? [];
      list.push(share);
      map.set(sourceId, list);
    }
    return map;
  }
);

export { isInactive as isShareInactive, isExhausted as isShareExhausted };
