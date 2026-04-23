/**
 * Active connectivity probing.
 *
 * `navigator.onLine` only reports whether a network interface exists — an
 * active VPN tunnel without upstream (e.g. Proton in airplane mode) still
 * yields `true`. The only reliable signal is a real HTTP round-trip against
 * a same-origin endpoint within a short budget.
 *
 * `probeOnline()` is a stateless one-shot check. `getConnectivity()` returns
 * a framework-agnostic reactive store (Svelte-compatible `subscribe`) that
 * re-probes on `online` / `visibilitychange` events and on a visibility-gated
 * interval. Consumers (sync services) can also hint a failure via
 * `markFailure()` to trigger an immediate re-probe.
 */

import { createLogger } from '@reborn/utils';

const logger = createLogger('Connectivity');

export type ConnectivityStatus = 'online' | 'offline' | 'unknown';

export interface ConnectivityState {
  status: ConnectivityStatus;
  lastProbeAt: number | null;
}

export interface ConnectivityOptions {
  /** Full URL of a same-origin endpoint that returns 2xx when reachable. */
  endpoint: string;
  /** Per-probe timeout. Default 3000ms. */
  probeTimeoutMs?: number;
  /** Visibility-gated interval between probes. Default 30000ms. 0 disables the timer. */
  intervalMs?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Stateless connectivity probe. Returns `true` only on a 2xx response within
 * `timeoutMs`. Swallows all errors (network, abort, CORS, etc.) → `false`.
 *
 * Falls back to GET when the server rejects HEAD (404/405), so the probe still
 * works against endpoints that only implement GET.
 */
export async function probeOnline(
  endpoint: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const res = await fetch(endpoint, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return true;
    if (res.status === 404 || res.status === 405) {
      const getRes = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return getRes.ok;
    }
    return false;
  } catch {
    return false;
  }
}

type Listener = (state: ConnectivityState) => void;

export class ConnectivityStore {
  private state: ConnectivityState = { status: 'unknown', lastProbeAt: null };
  private listeners = new Set<Listener>();
  private options: Required<ConnectivityOptions>;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<boolean> | null = null;

  private readonly onOnline = () => {
    void this.refresh();
  };
  private readonly onOffline = () => {
    this.setState({ status: 'offline', lastProbeAt: Date.now() });
  };
  private readonly onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.refresh();
    }
  };

  constructor(options: ConnectivityOptions) {
    this.options = {
      endpoint: options.endpoint,
      probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
    };

    if (typeof window === 'undefined') return;

    // Seed from navigator.onLine — the probe confirms shortly after. Keeping
    // status=unknown when the browser says "online" avoids flashing `offline`
    // before we've confirmed the VPN lie.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.state = { status: 'offline', lastProbeAt: null };
    }

    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    this.startInterval();
    void this.refresh();
  }

  /** Svelte readable contract: emits current state synchronously, then on change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): ConnectivityState {
    return this.state;
  }

  /** Fire a probe. Concurrent callers share the same in-flight promise. */
  async refresh(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const ok = await probeOnline(this.options.endpoint, this.options.probeTimeoutMs);
      this.setState({
        status: ok ? 'online' : 'offline',
        lastProbeAt: Date.now(),
      });
      return ok;
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Hint that a sync/fetch just failed. Triggers an immediate re-probe so the
   * indicator catches up with reality (the prior probe may be minutes stale).
   * Coalesced: does nothing if a probe is already in flight.
   */
  markFailure(): void {
    if (!this.inFlight) void this.refresh();
  }

  private setState(next: ConnectivityState): void {
    const statusChanged = next.status !== this.state.status;
    this.state = next;
    if (statusChanged) {
      logger.info(`Connectivity: ${next.status}`);
    }
    for (const listener of this.listeners) listener(this.state);
  }

  private startInterval(): void {
    if (this.options.intervalMs <= 0 || this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void this.refresh();
    }, this.options.intervalMs);
  }

  /** Teardown — primarily for tests / HMR. */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.onVisibility);
      }
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.listeners.clear();
  }
}

let singleton: ConnectivityStore | null = null;
let singletonEndpoint: string | null = null;

/**
 * Process-wide singleton. The first call binds the endpoint; subsequent calls
 * with a different endpoint log a warning and return the existing store —
 * each app must call this exactly once from its bootstrap.
 */
export function getConnectivity(options: ConnectivityOptions): ConnectivityStore {
  if (!singleton) {
    singleton = new ConnectivityStore(options);
    singletonEndpoint = options.endpoint;
  } else if (singletonEndpoint !== options.endpoint) {
    logger.warn(
      `connectivity already initialized with endpoint ${singletonEndpoint}; ignoring ${options.endpoint}`
    );
  }
  return singleton;
}

/** Test-only: drops the singleton so the next call reconstructs it. */
export function __resetConnectivityForTests(): void {
  singleton?.destroy();
  singleton = null;
  singletonEndpoint = null;
}
