/**
 * Concurrency cap for batched sync sweeps.
 *
 * The server's Prisma connection pool (`PrismaPg` in `packages/database`) takes
 * the node-postgres defaults - `max: 10` connections, `connectionTimeoutMillis:
 * 0` - and that pool is shared by every user of the container. With timeout 0 a
 * saturated pool queues new queries indefinitely instead of erroring, so a flat
 * `Promise.allSettled` over every pending item (a folder import can leave ~200
 * notes pending in a single run) fires the whole burst at once and, as the user
 * count grows, multiplies the peak. Capping in-flight work per sweep keeps one
 * client from monopolising the pool.
 *
 * Note: each `POST /api/notes` also runs `getUserStorageBreakdown` (a
 * `SUM(OCTET_LENGTH(...))` across the user's whole notes table), so a wide burst
 * is doubly expensive server-side. Making that quota count cheaper is tracked
 * separately (TODO P2) - this cap is the cheap, client-only first line.
 */
export const SYNC_BATCH_SIZE = 10;

/**
 * Run `task` over `items` in chunks of at most `limit`, awaiting each chunk
 * before starting the next. Like `Promise.allSettled`, a rejected task never
 * aborts its siblings - callers rely on that (one failed push must not strand
 * the rest of the sweep).
 *
 * This is a batch-barrier, not a rolling pool: the slowest item in a chunk gates
 * only that chunk. That keeps the helper trivial and matches the pull-side idiom
 * it replaced; the simplicity is worth more than squeezing the last bit of
 * throughput out of an error-path sweep. Production always uses the default
 * `limit` (`SYNC_BATCH_SIZE`); the parameter exists so tests can pin a small cap.
 */
export async function settleInBatches<T>(
  items: T[],
  task: (item: T) => Promise<unknown>,
  limit: number = SYNC_BATCH_SIZE
): Promise<void> {
  const size = Math.max(1, limit);
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(task));
  }
}
