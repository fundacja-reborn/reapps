import { describe, it, expect, vi } from 'vitest';
import { bulkRun } from './bulk';

describe('bulkRun', () => {
  it('counts every fulfilled call as done', async () => {
    const op = vi.fn().mockResolvedValue(undefined);
    const ids = ['a', 'b', 'c'];

    const result = await bulkRun(ids, op);

    expect(result).toEqual({ done: 3, failed: 0 });
    expect(op).toHaveBeenCalledTimes(3);
    expect(op).toHaveBeenNthCalledWith(1, 'a');
    expect(op).toHaveBeenNthCalledWith(2, 'b');
    expect(op).toHaveBeenNthCalledWith(3, 'c');
  });

  it('continues past a rejection and counts it as failed', async () => {
    // Mirrors the "note already gone in another tab" edge case — one id throws,
    // the rest still succeed and the bulk action surfaces a partial-success toast.
    const op = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('not found');
    });
    const ids = ['a', 'b', 'c', 'd'];

    const result = await bulkRun(ids, op);

    expect(result).toEqual({ done: 3, failed: 1 });
    expect(op).toHaveBeenCalledTimes(4);
  });

  it('counts all rejections as failed without throwing', async () => {
    const op = vi.fn(async () => {
      throw new Error('all gone');
    });
    const ids = ['x', 'y'];

    const result = await bulkRun(ids, op);

    expect(result).toEqual({ done: 0, failed: 2 });
  });

  it('handles empty input', async () => {
    const op = vi.fn();
    const result = await bulkRun([], op);
    expect(result).toEqual({ done: 0, failed: 0 });
    expect(op).not.toHaveBeenCalled();
  });

  it('invokes ops in parallel (not blocked by individual settles)', async () => {
    // Promise.allSettled fires all ops at once; total wall-clock should be
    // ≈ max(perItem) not sum(perItem). Use fake timers to assert this.
    vi.useFakeTimers();
    const op = vi.fn(
      (id: string) =>
        new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            if (id === 'fail') reject(new Error('x'));
            else resolve();
          }, 100);
        })
    );

    const pending = bulkRun(['a', 'b', 'fail', 'c'], op);
    await vi.advanceTimersByTimeAsync(99);
    // Still pending — none of the 100ms timeouts have fired.
    // Now advance one more ms; all four should settle.
    await vi.advanceTimersByTimeAsync(2);
    const result = await pending;

    expect(result).toEqual({ done: 3, failed: 1 });
    vi.useRealTimers();
  });
});
