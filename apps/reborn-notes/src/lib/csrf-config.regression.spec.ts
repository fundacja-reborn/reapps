import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Both PWAs ship a native (Capacitor) build that talks to the remote API
 * cross-origin (the WebView loads from a local scheme and calls the remote
 * API). SvelteKit's default CSRF `checkOrigin` forbids any cross-origin
 * POST/PUT/PATCH/DELETE carrying a "form" content-type, which 403s every
 * bodiless native mutation - note / folder / tag / saved-search delete and note
 * restore (they send no application/json content-type to exempt them) - while
 * same-origin web never trips it. That silently broke ALL native deletes and
 * restores (found in native smoke 2026-06-28).
 *
 * Disabling it is safe: API auth is bearer-token (Authorization header, never an
 * ambient cookie auto-attached cross-site) and the only cookie - the web
 * refresh_token - is httpOnly + SameSite=Lax (never sent on a cross-site
 * request). The origin check is redundant with those defenses and only ever
 * rejected the legitimate native client. `trustedOrigins: ['*']` is SvelteKit
 * 2.63's non-deprecated spelling of "trust every origin" (SvelteKit compiles it
 * to `csrf_check_origin: false`); it also covers a native request that carries
 * no Origin header, which an explicit allowlist could not. This source-level
 * guard pins the decision for both apps so it cannot be re-enabled by accident.
 * See guideline 36.
 */
function readConfig(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

const APPS: ReadonlyArray<readonly [string, string]> = [
  ['reborn-notes', '../../svelte.config.js'],
  ['reborn-task', '../../../reborn-task/svelte.config.js']
];

describe('CSRF origin check disabled for native cross-origin clients', () => {
  for (const [app, rel] of APPS) {
    it(`${app}: kit.csrf.trustedOrigins is ['*']`, () => {
      const cfg = readConfig(rel);
      expect(
        cfg,
        `${app} must set csrf.trustedOrigins:['*'] (native cross-origin mutations)`
      ).toMatch(/csrf:\s*\{\s*trustedOrigins:\s*\[\s*'\*'\s*\]\s*\}/);
    });
  }
});
