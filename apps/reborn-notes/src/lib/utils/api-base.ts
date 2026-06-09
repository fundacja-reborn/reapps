import { base } from '$app/paths';
import { env } from '$env/dynamic/public';

/**
 * Origin + prefix for every server API call in Notes.
 *
 * - **Web (same-origin):** `${base}/api`. `base` is set from `PUBLIC_BASE_PATH`
 *   in svelte.config.js, so this is byte-identical to the previous call sites
 *   that hard-coded `${base}/api` or `${PUBLIC_BASE_PATH}/api`.
 * - **Native (Capacitor):** the absolute remote API, from `PUBLIC_API_BASE_URL`
 *   (set by the `build-native*` targets, includes `/api`, e.g.
 *   `https://reapps.eu/notes/api`). The native shell loads its own code locally,
 *   so the API is always cross-origin.
 *
 * `$env/dynamic/public` returns `undefined` for an unset var (no build error),
 * and the web build never sets `PUBLIC_API_BASE_URL`, so web falls back to
 * `${base}/api`. Call sites use `${API_BASE}/notes`, `${API_BASE}/auth/login`, etc.
 *
 * Replaces the Faza 0 spike hack (PUBLIC_BASE_PATH repurposed as the API origin)
 * and fixes the `${base}`-prefixed endpoints that stayed local on native.
 */
export const API_BASE = env.PUBLIC_API_BASE_URL || `${base}/api`;
