import { browser } from '$app/environment';
import { derived, readable, type Readable } from 'svelte/store';
import { platform } from '$lib/platform';
import type { NetworkState, PlatformNetwork } from '@reborn/platform';

/**
 * App-facing connectivity, sourced from the platform layer (`@reborn/platform`).
 *
 * - **Web**: an active HTTP probe against this app's same-origin `/api/health`
 *   (configured in `$lib/platform`). `navigator.onLine` lies with a VPN tunnel
 *   up - e.g. Proton in airplane mode keeps a network interface alive - so only
 *   a real round-trip against our own origin tells the truth.
 * - **Native**: device network state via `@capacitor/network`. The web HTTP
 *   probe is meaningless in the shell (assets are local and answer same-origin
 *   regardless of upstream), which is why connectivity moved behind the platform
 *   abstraction in Faza 3.
 *
 * The exported surface is unchanged, so consumers (sync-status store, sync
 * service, layout) need no changes.
 */

const ssrState: NetworkState = { status: 'unknown', lastProbeAt: null };

export const connectivityStore: PlatformNetwork | null = browser ? platform.network : null;

export const connectivity: Readable<NetworkState> = connectivityStore
  ? { subscribe: connectivityStore.subscribe.bind(connectivityStore) }
  : readable(ssrState);

export const isOnline: Readable<boolean> = derived(
  connectivity,
  ($c) => $c.status === 'online' || $c.status === 'unknown'
);

/** Synchronous check: `true` unless the last probe definitively failed. */
export function checkOnline(): boolean {
  if (!connectivityStore) return true;
  return connectivityStore.getState().status !== 'offline';
}
