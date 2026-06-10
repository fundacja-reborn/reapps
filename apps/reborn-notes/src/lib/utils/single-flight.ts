/**
 * Leading + trailing single-flight coalescing for an async thunk.
 *
 * Wraps `fn` so that:
 * - the first call starts it (leading edge);
 * - any call that arrives **while a run is in flight** is coalesced onto ONE
 *   trailing run that begins only **after** the current run finishes.
 *
 * Two properties matter for sync (see `pullFromServer`):
 *
 * 1. **At most one run on the wire at a time.** Bursts of triggers (login, the
 *    layout initial sync, the offline->online handler, native App 'resume') no
 *    longer fan out into N concurrent pulls - which would duplicate every
 *    per-note request (e.g. `/versions`), wasteful and slow on native HTTP.
 *
 * 2. **A caller that just mutated state sees a fresh run.** Callers awaiting
 *    during an in-flight run resolve with the *trailing* run's result, and the
 *    trailing run STARTS after the current one ends. So a handler that does
 *    `await push; await pull()` gets a pull that began after its push landed -
 *    never a stale in-flight pull that started before it. (A plain "return the
 *    in-flight promise" single-flight breaks this: the post-push caller gets the
 *    pre-push run, which then misreads the freshly-pushed row as an orphaned
 *    edit and re-marks it pending, churning until a fresh pull catches up.)
 *
 * The wrapper is sync-state only; `fn`'s own result (including a thrown error) is
 * passed through unchanged to whoever is awaiting that particular run.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  let trailing: Promise<T> | null = null;

  function startTrailing(): Promise<T> {
    // The leading run has settled (its `finally` already cleared `inFlight`), so
    // calling run() now takes the leading-edge branch and starts a fresh run.
    trailing = null;
    return run();
  }

  function run(): Promise<T> {
    if (!inFlight) {
      inFlight = fn().finally(() => {
        inFlight = null;
      });
      return inFlight;
    }
    // A run is in flight: coalesce this caller (and any others arriving now) onto
    // a single trailing run that starts once the current one settles. Settle on
    // both fulfilment and rejection so a failed run still releases the trailing.
    if (!trailing) {
      trailing = inFlight.then(startTrailing, startTrailing);
    }
    return trailing;
  }

  return run;
}
