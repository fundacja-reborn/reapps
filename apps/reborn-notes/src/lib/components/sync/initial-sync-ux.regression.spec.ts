import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Initial-sync UX (issue reported by Michał, smoke #2 of PR #356, 2026-06-28).
 *
 * During a cold-login sync the notes stream into the list incrementally (#356),
 * but the periodic-note buttons (daily/weekly/monthly) gate on the in-flight
 * pull (periodic-notes.service `getOrCreateNote`) to avoid creating a duplicate
 * of a note that's still on an un-paged page. Before this change the gated click
 * looked DEAD - no feedback while it waited. Variant B (chosen) keeps the
 * incremental reveal and adds two non-blocking signals:
 *   1. A top banner (InitialSyncBanner) with determinate progress, mounted in
 *      +layout.svelte's measured banner stack so it feeds --rn-banner-h.
 *   2. A spinner on the periodic button that is mid-resolve (IconNav.pendingKind,
 *      driven by +page.svelte's periodicPendingKind around the await).
 *
 * Source-level guards (the repo's regression idiom): the renderer is awkward to
 * mount in a Node env, so we pin the contracts that are easy to silently break.
 */

function readSource(relative: string): string {
  return readFileSync(resolve(__dirname, relative), 'utf-8');
}

describe('initial-sync UX - banner + periodic pending (2026-06-28)', () => {
  describe('InitialSyncBanner', () => {
    const src = readSource('./InitialSyncBanner.svelte');

    it('renders only while the FIRST sync is active, not on every sync', () => {
      expect(src).toMatch(
        /import\s*\{[^}]*\bisInitialSync\b[^}]*\bsyncProgress\b[^}]*\}\s*from\s*'\$lib\/stores\/sync-status\.store'/s
      );
      // isInitialSync (cleared by refreshStoresAfterPull) gates the banner; a warm
      // periodic sync must NOT pop it. The 300ms delay is anti-flicker, not the gate.
      expect(src).toMatch(/\{#if[^}]*\$isInitialSync[^}]*\}/);
    });

    it('switches to a determinate progressbar once a positive total is known', () => {
      // Indeterminate (sliding bar) until syncProgress reports total > 0, then a
      // real determinate progressbar - the key "is it frozen?" answer on native.
      expect(src).toMatch(/syncProgress\?\.total/);
      expect(src).toMatch(/role="progressbar"/);
      expect(src).toMatch(/\$t\('sync_status\.initial\.building'\)/);
    });

    it('slides in/out (reduced-motion aware) instead of snapping the layout', () => {
      // The banner stack feeds --rn-banner-h, which the 100dvh layouts subtract;
      // a bare {#if} mount/unmount snaps the whole UI by the banner height in one
      // frame. transition:slide animates it, and the ResizeObserver-based
      // bind:clientHeight makes the layout follow per frame (2026-07-09).
      expect(src).toMatch(
        /transition:slide=\{\{\s*duration:\s*prefersReducedMotion\.current\s*\?\s*0\s*:/
      );
    });
  });

  describe('runPullFromServer initial-sync gate', () => {
    const src = readSource('../../services/notes-sync.service.ts');

    it('raises isInitialSync only when the local notes table is EMPTY, not on every cold boot', () => {
      // lastSyncedAt is in-memory (null in every fresh JS context), so alone it
      // misread every native cold start as a first sync - the banner flashed
      // "building local database" over an already-built DB for the 1-2s the
      // CapacitorHttp pull needs before the first notes page, then jumped the
      // layout back (2026-07-09). The gate must also require an empty table.
      expect(src).toMatch(
        /get\(lastSyncedAt\)\s*===\s*null\s*&&\s*\(await noteStore\.count\(\)\)\s*===\s*0/
      );
    });
  });

  describe('+layout.svelte banner mount', () => {
    const src = readSource('../../../routes/+layout.svelte');

    it('mounts InitialSyncBanner INSIDE the measured div that feeds --rn-banner-h', () => {
      expect(src).toMatch(
        /import\s+InitialSyncBanner\s+from\s+'\$lib\/components\/sync\/InitialSyncBanner\.svelte'/
      );
      // The 100dvh page/settings layouts subtract --rn-banner-h. If the banner sits
      // OUTSIDE the measured div, the var stays 0 and the banner overlaps content
      // (IconNav avatar clipped off-screen). Pin: banner is within the measured div.
      expect(src).toMatch(/--rn-banner-h:\s*\{bannerStackHeight\}px/);
      const measuredStart = src.indexOf('bind:clientHeight={bannerStackHeight}');
      expect(measuredStart).toBeGreaterThan(-1);
      const measuredDiv = src.slice(measuredStart, src.indexOf('</div>', measuredStart));
      expect(measuredDiv).toMatch(/<InitialSyncBanner\b/);
    });
  });

  describe('IconNav periodic pending spinner', () => {
    const src = readSource('../layout/IconNav.svelte');

    it('accepts a pendingKind prop and imports the spinner icon', () => {
      expect(src).toMatch(/pendingKind\?:\s*PeriodicKind\s*\|\s*null/);
      expect(src).toMatch(/\bLoader2\b/);
    });

    it('shows the spinner only on the kind that is resolving, in both nav modes', () => {
      expect(src).toMatch(/isPending\s*=\s*pendingKind\s*===\s*p\.kind/);
      // One {#if isPending} per nav mode (horizontal mobile + vertical desktop rail).
      const gates = src.match(/\{#if isPending\}/g) ?? [];
      expect(gates.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('+page.svelte handlePeriodic pending lifecycle', () => {
    const src = readSource('../../../routes/+page.svelte');

    function handlePeriodicBody(): string {
      const start = src.indexOf('async function handlePeriodic(');
      expect(start).toBeGreaterThan(-1);
      const after = src.slice(start + 1);
      const next = after.indexOf('\n  async function ');
      return src.slice(start, next > -1 ? start + 1 + next : src.length);
    }

    it('wires the pending kind into both IconNav instances', () => {
      const mounts = src.match(/pendingKind=\{periodicPendingKind\}/g) ?? [];
      expect(mounts.length).toBe(2);
    });

    it('clears the pending kind in finally so a failed/late resolve never sticks the spinner', () => {
      const body = handlePeriodicBody();
      // Re-click guard: a second click on a kind already resolving is a no-op
      // (getOrCreateNote awaits the single-flight pull; a second await is redundant).
      expect(body).toMatch(/if\s*\(\s*periodicPendingKind\s*===\s*kind\s*\)\s*return/);
      // The reset MUST be in finally - on the error path too (toast + stuck spinner
      // would otherwise be worse than the silence we're fixing).
      const finallyIdx = body.indexOf('finally');
      expect(finallyIdx).toBeGreaterThan(-1);
      expect(body.slice(finallyIdx)).toMatch(/periodicPendingKind\s*=\s*null/);
    });
  });

  describe('periodic duplicate prompt - modal, not toast (smoke #2)', () => {
    const svc = readSource('../../services/periodic-dedup.service.ts');
    const layout = readSource('../../../routes/+layout.svelte');

    function exportBody(name: string): string {
      const start = svc.indexOf('export ' + name);
      expect(start).toBeGreaterThan(-1);
      const next = svc.indexOf('\nexport ', start + 1);
      return svc.slice(start, next > -1 ? next : svc.length);
    }

    it('exposes a store-driven prompt + confirm/dismiss API', () => {
      expect(svc).toMatch(/export const periodicDuplicatePrompt = writable</);
      expect(svc).toMatch(/export async function confirmMergePeriodicDuplicates/);
      expect(svc).toMatch(/export function dismissPeriodicDuplicatePrompt/);
    });

    it('detection posts to the prompt store, not an auto-dismissing toast', () => {
      const body = exportBody('async function detectAndNotifyPeriodicDuplicates');
      expect(body).toMatch(/periodicDuplicatePrompt\.set\(/);
      // The old warning toast (which vanished before the user could act) is gone.
      expect(body).not.toMatch(/toastStore\.warning/);
    });

    it('confirm runs the merge and clears the prompt in finally so the modal always closes', () => {
      const body = exportBody('async function confirmMergePeriodicDuplicates');
      expect(body).toMatch(/mergeAllPeriodicDuplicates\(\)/);
      const finallyIdx = body.indexOf('finally');
      expect(finallyIdx).toBeGreaterThan(-1);
      expect(body.slice(finallyIdx)).toMatch(/periodicDuplicatePrompt\.set\(\s*null\s*\)/);
    });

    it('mounts the merge confirmation modal globally in the layout', () => {
      expect(layout).toMatch(/import\s+PeriodicDuplicatesDialog\s+from/);
      expect(layout).toMatch(/<PeriodicDuplicatesDialog\b/);
    });
  });
});
