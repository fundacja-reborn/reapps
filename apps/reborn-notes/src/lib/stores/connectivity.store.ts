import { browser } from '$app/environment';
import { API_BASE } from '$lib/utils/api-base';
import { derived, readable, type Readable } from 'svelte/store';
import {
  getConnectivity,
  type ConnectivityState,
  type ConnectivityStore
} from '@reborn/api-client';

/**
 * App-local wrapper around `@reborn/api-client`'s connectivity singleton.
 * Binds the probe endpoint to this app's health endpoint via `API_BASE`
 * (same-origin `/api/health` on web, the configured API origin on native)
 * and exposes Svelte stores for reactive consumption.
 *
 * Why an active probe instead of `navigator.onLine`: an active VPN tunnel
 * (e.g. Proton in airplane mode) keeps a network interface up, so the browser
 * reports `online: true` even when there is no upstream. Only a real HTTP
 * round-trip against our own origin tells the truth.
 */

const ssrState: ConnectivityState = { status: 'unknown', lastProbeAt: null };

export const connectivityStore: ConnectivityStore | null = browser
  ? getConnectivity({ endpoint: `${API_BASE}/health` })
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
