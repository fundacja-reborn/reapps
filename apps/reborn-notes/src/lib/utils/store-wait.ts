import { get, type Readable } from 'svelte/store';

/**
 * Resolve once `store` holds a falsy value.
 *
 * Returns an already-resolved promise when the store is falsy right now, so the
 * common (steady-state) path costs nothing. Otherwise subscribes and resolves
 * on the first falsy emission, then unsubscribes.
 *
 * Used to gate a read on an in-flight async flag (e.g. `isSyncing`) without
 * polling: "if a pull is running, wait for it to finish, then look again".
 */
export function whenFalsy<T>(store: Readable<T>): Promise<void> {
  if (!get(store)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const unsub = store.subscribe((value) => {
      if (value || settled) return;
      settled = true;
      resolve();
      // Defer the unsubscribe: on a synchronous falsy emission `unsub` may not
      // be assigned yet. We never reach here on the initial subscribe call
      // (the `get` guard above means the store is truthy at subscribe time),
      // but the microtask hop keeps this correct for any store contract.
      queueMicrotask(() => unsub());
    });
  });
}
