import { base } from '$app/paths';
import { env } from '$env/dynamic/public';

/**
 * Origin + prefix for every server API call in re/task.
 *
 * - **Web (same-origin):** `${base}/api`. `base` comes from `PUBLIC_BASE_PATH`
 *   in svelte.config.js, so this is byte-identical to the call sites that used
 *   `${base}/api` or `${PUBLIC_BASE_PATH}/api`.
 * - **Native (Capacitor):** the absolute remote API from `PUBLIC_API_BASE_URL`
 *   (set by the `build-native*` targets, includes `/api`, e.g.
 *   `https://reapps.eu/task/api`). The shell loads its own code locally, so the
 *   API is always cross-origin.
 *
 * `$env/dynamic/public` returns `undefined` for an unset var, and the web build
 * never sets `PUBLIC_API_BASE_URL`, so web falls back to `${base}/api` (same
 * helper as re/notes; the native value lands in `_app/env.js`, where the store
 * build checks read it). Call sites use `${API_BASE}/tasks`,
 * `${API_BASE}/auth/login`, ...
 */
export const API_BASE = env.PUBLIC_API_BASE_URL || `${base}/api`;
