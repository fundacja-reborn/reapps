import { base } from '$app/paths';
import { browser } from '$app/environment';
import { derived, readable, type Readable } from 'svelte/store';
import {
  getConnectivity,
  type ConnectivityState,
  type ConnectivityStore
} from '@reborn/api-client';

/**
 * App-local wrapper around `@reborn/api-client`'s connectivity singleton.
 * Binds the probe endpoint to this app's `/api/health` and exposes Svelte
 * stores for reactive consumption.
 *
 * Why an active probe instead of `navigator.onLine`: an active VPN tunnel
 * (e.g. Proton in airplane mode) keeps a network interface up, so the browser
 * reports `online: true` even when there is no upstream. Only a real HTTP
 * round-trip against our own origin tells the truth.
 *
 * NOTE: kept on the same-origin `${base}/api/health` on purpose - do NOT route
 * it through `API_BASE`. The probe uses a HEAD request, which CapacitorHttp
 * delivers unreliably cross-origin on native, so pointing it at the remote API
 * made the app read "offline" while sync (normal GET/POST) worked. Real native
 * connectivity belongs in Faza 3 via `@capacitor/network` (device network
 * state), not an HTTP HEAD probe. On native this stays same-origin and is
 * effectively always-online (the static shell answers `/api/health`).
 */

const ssrState: ConnectivityState = { status: 'unknown', lastProbeAt: null };

export const connectivityStore: ConnectivityStore | null = browser
  ? getConnectivity({ endpoint: `${base}/api/health` })
  : null;

export const connectivity: Readable<ConnectivityState> = connectivityStore
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
