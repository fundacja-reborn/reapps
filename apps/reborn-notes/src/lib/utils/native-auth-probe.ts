/**
 * Dev-only native refresh probe (Faza 2 validation). Native build only.
 *
 * Exposes `window.__rebornAuthProbe(n?)` so the rotated-refresh-token path can be
 * validated on the emulator without waiting 15 minutes per natural refresh. Run
 * it from the remote webview console (Android: chrome://inspect) AFTER logging in:
 *
 *   await __rebornAuthProbe(5)
 *
 * It fires N sequential `authFetch.refresh()` calls and, for each, checks that a
 * fresh access token came back AND the secure-storage refresh token actually
 * rotated. The point is to prove that >=3 rotations survive without the server's
 * token-reuse detector revoking the family (which would surface as a NULL result
 * and a dead session). A single NULL/ERROR aborts the run.
 *
 * Gated behind `__REBORN_NATIVE__`, so it is dead-code-eliminated from the web
 * build and never attaches on web. Temporary - remove before Faza 5 store prep.
 */
import { authFetch } from '$lib/utils/auth-fetch';
import { readNativeRefreshToken } from '$lib/utils/native-auth-storage';

export function installNativeAuthProbe(): void {
  if (!__REBORN_NATIVE__ || typeof window === 'undefined') return;

  (window as unknown as Record<string, unknown>).__rebornAuthProbe = async (
    n = 5
  ): Promise<string[]> => {
    const out: string[] = [];
    for (let i = 1; i <= n; i++) {
      try {
        const before = await readNativeRefreshToken();
        const accessToken = await authFetch.refresh();
        const after = await readNativeRefreshToken();
        const rotated = !!after && after !== before;
        const line = accessToken
          ? `#${i}: OK  access=...${accessToken.slice(-8)}  refreshRotated=${rotated}`
          : `#${i}: NULL (session gone - refresh failed / family revoked)`;
        out.push(line);
        // eslint-disable-next-line no-console
        console.log('[rebornAuthProbe]', line);
        if (!accessToken) break;
      } catch (err) {
        const line = `#${i}: ERROR ${err instanceof Error ? err.message : String(err)}`;
        out.push(line);
        // eslint-disable-next-line no-console
        console.error('[rebornAuthProbe]', line);
        break;
      }
    }
    // eslint-disable-next-line no-console
    console.log('[rebornAuthProbe] done', out);
    return out;
  };
}
