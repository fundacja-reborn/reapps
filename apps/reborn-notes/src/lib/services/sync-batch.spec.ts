import { describe, it, expect } from 'vitest';
import { settleInBatches, SYNC_BATCH_SIZE } from './sync-batch';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('settleInBatches', () => {
  it('processes every item', async () => {
    const seen: number[] = [];
    await settleInBatches([1, 2, 3, 4, 5], async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('is a no-op on an empty list', async () => {
    let called = 0;
    await settleInBatches([], async () => {
      called++;
    });
    expect(called).toBe(0);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);
    await settleInBatches(
      items,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
      },
      4
    );
    expect(peak).toBe(4);
  });

  it('defaults the cap to SYNC_BATCH_SIZE', async () => {
    let inFlight = 0;
    let peak = 0;
    // More items than the default cap so the cap is the binding constraint.
    const items = Array.from({ length: SYNC_BATCH_SIZE * 2 + 3 }, (_, i) => i);
    await settleInBatches(items, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
    });
    expect(peak).toBe(SYNC_BATCH_SIZE);
  });

  it('waits for a chunk to fully settle before starting the next (batch barrier)', async () => {
    const items = [0, 1, 2, 3];
    const gates = items.map(() => deferred());
    const started: number[] = [];

    const done = settleInBatches(
      items,
      async (i) => {
        started.push(i);
        await gates[i].promise;
      },
      2
    );

    // First chunk (2 items) started; the second chunk must NOT have started yet.
    await tick();
    expect(started).toEqual([0, 1]);

    // Release the first chunk - only now may the second start.
    gates[0].resolve();
    gates[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2].resolve();
    gates[3].resolve();
    await done;
  });

  it('a rejected task neither aborts its siblings nor rejects the call', async () => {
    const seen: number[] = [];
    await expect(
      settleInBatches(
        [1, 2, 3, 4, 5],
        async (n) => {
          if (n === 3) throw new Error('boom');
          seen.push(n);
        },
        2
      )
    ).resolves.toBeUndefined();
    // Every non-throwing item still ran, including those batched alongside the
    // thrower and in later chunks.
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 4, 5]);
  });
});
