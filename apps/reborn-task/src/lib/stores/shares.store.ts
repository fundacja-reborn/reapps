import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { authFetch } from '$lib/utils/auth-fetch';
import { connectivityStore } from '$lib/stores/connectivity.store';
import { sessionExpired } from '$lib/stores/session-expired.store';
import { localOnly } from '$lib/stores/local-mode.store';
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
	type SharedSnapshotTaskPayload
} from '@reborn/types';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Task-SharesStore');

export type DecodedTaskShare = {
	payload: SharedSnapshotTaskPayload;
	url: string;
};

export type SharesState = {
	loading: boolean;
	shares: OwnShareListItem[];
	decoded: Record<string, DecodedTaskShare>;
	decryptErrors: Set<string>;
	error: string | null;
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
		decoded: Record<string, DecodedTaskShare>;
		decryptErrors: Set<string>;
	}> {
		const nextDecoded: Record<string, DecodedTaskShare> = {};
		const nextErrors = new Set<string>();
		if (!cryptoManager.isInitialized()) return { decoded: nextDecoded, decryptErrors: nextErrors };
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
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
				const url = buildShareUrl(`${origin}${base}`, s.slug, rawKey, SNAPSHOT_PAYLOAD_VERSION);
				try {
					const key = await importKeyFromBase64url(rawKey);
					const plaintext = await decryptSnapshotPayload(s.payload_encrypted, key);
					const parsed = SharedSnapshotPayloadSchema.safeParse(plaintext);
					if (!parsed.success || parsed.data.type !== 'task') {
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
		// Local-only / no-account mode: sharing is account-only and there is no
		// token, so hitting /api/shares would 401 and trip the session-expired
		// banner. The crypto key IS loaded locally, so the isInitialized() guard
		// below is not enough on its own.
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
			const res = await authFetch(`${base}/api/shares`);
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
		} catch (err: unknown) {
			logger.error('Fetch shares failed:', err);
			state.update((s) => ({ ...s, loading: false, error: 'load_failed' }));
		}
	}

	async function revoke(slug: string): Promise<boolean> {
		if (!browser) return false;
		try {
			const res = await authFetch(`${base}/api/shares/${slug}`, { method: 'DELETE' });
			if (!res.ok) return false;
			const now = new Date().toISOString();
			state.update((s) => ({
				...s,
				shares: s.shares.map((sh) => (sh.slug === slug ? { ...sh, revoked_at: now } : sh))
			}));
			return true;
		} catch (err: unknown) {
			logger.error('Revoke failed:', err);
			return false;
		}
	}

	function reset() {
		state.set({ ...initialState, decryptErrors: new Set(), decoded: {}, shares: [] });
	}

	function init() {
		if (initialized || !browser) return;
		initialized = true;
		if (cryptoManager.isInitialized()) {
			void refresh();
		}
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
		snapshot: () => get(state)
	};
}

export const sharesStore = createSharesStore();

export const activeShares = derived(sharesStore, ($s) => {
	return $s.shares.filter((sh) => {
		if (isInactive(sh)) return false;
		if (sh.snapshot_type === 'task') return true;
		if (sh.snapshot_type === 'unknown') {
			return $s.decoded[sh.id]?.payload.type === 'task';
		}
		return false;
	});
});

export const activeSharesCount = derived(activeShares, ($s) => $s.length);

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
