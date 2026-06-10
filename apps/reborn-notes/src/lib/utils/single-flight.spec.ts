import { describe, it, expect } from 'vitest';
import { singleFlight } from './single-flight';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Drain microtasks + one macrotask so coalescing's .then chains have settled.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('singleFlight', () => {
  it('runs fn once per call when calls do not overlap', async () => {
    let calls = 0;
    const flighted = singleFlight(async () => {
      calls++;
      return calls;
    });
    expect(await flighted()).toBe(1);
    expect(await flighted()).toBe(2);
    expect(calls).toBe(2);
  });

  it('coalesces callers arriving during an in-flight run onto ONE trailing run', async () => {
    const deferreds: Array<ReturnType<typeof deferred<number>>> = [];
    let calls = 0;
    const flighted = singleFlight(() => {
      calls++;
      const d = deferred<number>();
      deferreds.push(d);
      return d.promise;
    });

    const leading = flighted(); // starts run #1 (leading edge)
    expect(calls).toBe(1);

    // Three callers arrive while run #1 is in flight -> one trailing run, not three.
    const a = flighted();
    const b = flighted();
    const c = flighted();
    expect(calls).toBe(1); // trailing hasn't started (run #1 still pending)

    deferreds[0].resolve(11);
    expect(await leading).toBe(11);
    await flush();

    expect(calls).toBe(2); // leading + exactly one trailing

    deferreds[1].resolve(22);
    expect(await a).toBe(22);
    expect(await b).toBe(22);
    expect(await c).toBe(22);
    expect(calls).toBe(2);
  });

  it('starts the trailing run only AFTER the leading run settles', async () => {
    const order: string[] = [];
    const d1 = deferred<void>();
    let started = 0;
    const flighted = singleFlight(async () => {
      started++;
      const which = started;
      order.push(`start#${which}`);
      if (which === 1) await d1.promise;
      order.push(`end#${which}`);
    });

    const leading = flighted();
    const trailing = flighted(); // queued while leading runs
    expect(order).toEqual(['start#1']);

    d1.resolve();
    await Promise.all([leading, trailing]);
    expect(order).toEqual(['start#1', 'end#1', 'start#2', 'end#2']);
  });

  it('a rejected leading run still releases the trailing run', async () => {
    let calls = 0;
    const flighted = singleFlight(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return calls;
    });

    const leading = flighted();
    const trailing = flighted();
    await expect(leading).rejects.toThrow('boom');
    expect(await trailing).toBe(2);
  });

  it('starts fresh again once everything has settled', async () => {
    let calls = 0;
    const flighted = singleFlight(async () => {
      calls++;
      return calls;
    });
    await flighted();
    await flighted();
    expect(calls).toBe(2);
    await flighted();
    expect(calls).toBe(3);
  });
});
