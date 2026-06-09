#!/usr/bin/env node
/**
 * Generate `src/app.native.html` from `src/app.html` for the Capacitor (static)
 * build. Run before `vite build` in the `build-native*` Nx targets; the output is
 * gitignored (a build artifact), so it never drifts from app.html.
 *
 * Transforms (native static + hash-CSP needs these):
 *  1. Strip `nonce="%sveltekit.nonce%"` - a prerendered SPA fallback can't fill a
 *     per-request nonce, and native CSP is hash-based.
 *  2. Drop the web manifest <link> - served by a +server.ts route absent from the
 *     static bundle (was a 404); Capacitor provides app identity natively.
 *  3. Drop the web/PWA-only inline <script> blocks (theme-flash, offline/SW
 *     detect): SvelteKit does not hash template inline scripts, so under hash-CSP
 *     they'd be blocked; offline/SW detection is moot under Capacitor. The only
 *     inline script left in the rendered page is SvelteKit's bootstrap, which it
 *     hashes itself. Trade-off: brief theme FOUC on native cold start.
 *  4. Drop the now-orphaned data-stall-msg / data-offline-msg attrs.
 *
 * Self-validating: throws (fails the build) if app.html changed in a way that
 * leaves a nonce placeholder or an un-hashable inline script - prompting an
 * update here instead of silently shipping a broken native CSP.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src/app.html');
const OUT = resolve(here, '../src/app.native.html');

let html = readFileSync(SRC, 'utf-8');

// 1. CSP nonce attributes.
html = html.replace(/ nonce="%sveltekit\.nonce%"/g, '');
// 2. Web manifest link.
html = html.replace(/[\t ]*<link rel="manifest"[^>]*>\r?\n/g, '');
// 4. Orphaned loading-message data attrs (consumed only by the dropped script).
html = html.replace(/[\t ]*data-(?:stall|offline)-msg="[^"]*"\r?\n?/g, '');
// 3. Web/PWA-only inline scripts (no `src`). Leaves <style> blocks intact.
html = html.replace(/[\t ]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\r?\n?/g, '');

const banner =
  '<!--\n' +
  '  GENERATED from app.html by scripts/gen-native-template.mjs - DO NOT EDIT.\n' +
  '  Native (Capacitor) template for the static + hash-CSP build. Regenerated on\n' +
  '  every `build-native*`; gitignored. See the script for the transforms.\n' +
  '-->\n';
html = html.replace(/^<!doctype html>\r?\n/i, (m) => m + banner);

// Guardrails - fail loudly if app.html drifted past what the transforms handle.
if (html.includes('%sveltekit.nonce%')) {
  throw new Error('gen-native-template: nonce placeholder remains - prerender would fail. Update the transforms.');
}
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) {
  throw new Error('gen-native-template: an inline <script> remains - hash-CSP would block it. Update the transforms.');
}

writeFileSync(OUT, html);
console.log('gen-native-template: wrote src/app.native.html from app.html');
