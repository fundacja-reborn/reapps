import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * native-session is gated by the build-time `IS_NATIVE` (from native-client).
 * We flip it per-test with vi.doMock + a module reset so we can assert both the
 * native behavior and the web byte-identical no-op (the contract that matters:
 * a web build must never write session_id to storage or attach the header).
 */
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  });
});

async function loadWith(isNative: boolean) {
  vi.doMock('$lib/utils/native-client', () => ({ IS_NATIVE: isNative }));
  return import('./native-session');
}

describe('native-session (IS_NATIVE=true)', () => {
  it('persists, reads back, and exposes the id as a header', async () => {
    const m = await loadWith(true);
    m.persistNativeSessionId('sess-1');
    expect(m.readNativeSessionId()).toBe('sess-1');
    expect(m.nativeSessionHeader()).toEqual({ [m.NATIVE_SESSION_HEADER]: 'sess-1' });
  });

  it('clears the id on logout', async () => {
    const m = await loadWith(true);
    m.persistNativeSessionId('sess-1');
    m.clearNativeSessionId();
    expect(m.readNativeSessionId()).toBeNull();
    expect(m.nativeSessionHeader()).toEqual({});
  });

  it('ignores empty/nullish ids (no accidental blank write)', async () => {
    const m = await loadWith(true);
    m.persistNativeSessionId(undefined);
    m.persistNativeSessionId('');
    expect(m.readNativeSessionId()).toBeNull();
    expect(m.nativeSessionHeader()).toEqual({});
  });
});

describe('native-session (IS_NATIVE=false) — web byte-identical', () => {
  it('never writes session_id and never attaches the header', async () => {
    const m = await loadWith(false);
    m.persistNativeSessionId('sess-1');
    expect(m.readNativeSessionId()).toBeNull(); // nothing persisted on web
    expect(store.size).toBe(0); // localStorage untouched
    expect(m.nativeSessionHeader()).toEqual({});
    expect(() => m.clearNativeSessionId()).not.toThrow();
  });
});
