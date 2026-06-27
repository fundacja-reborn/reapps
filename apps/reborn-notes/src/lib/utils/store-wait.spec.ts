import { describe, it, expect } from 'vitest';
import { writable } from 'svelte/store';
import { whenFalsy } from './store-wait';

describe('whenFalsy', () => {
  it('resolves immediately when the store is already falsy', async () => {
    const s = writable(false);
    let resolved = false;
    await whenFalsy(s).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true);
  });

  it('waits for a truthy store to flip falsy', async () => {
    const s = writable(true);
    let resolved = false;
    const p = whenFalsy(s).then(() => {
      resolved = true;
    });

    // Still pending while truthy.
    await Promise.resolve();
    expect(resolved).toBe(false);

    s.set(false);
    await p;
    expect(resolved).toBe(true);
  });

  it('ignores intermediate truthy churn and resolves only on the first falsy', async () => {
    const s = writable<number>(1);
    let resolveCount = 0;
    const p = whenFalsy(s).then(() => {
      resolveCount++;
    });

    s.set(2); // still truthy
    s.set(3); // still truthy
    await Promise.resolve();
    expect(resolveCount).toBe(0);

    s.set(0); // falsy
    await p;
    // Further changes must not re-fire (already unsubscribed).
    s.set(5);
    s.set(0);
    await Promise.resolve();
    expect(resolveCount).toBe(1);
  });
});
