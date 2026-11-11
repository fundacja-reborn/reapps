/**
 * Which local versions a history pull must remove (#521).
 *
 * Pure decision, kept out of notes-sync.service (browser-only deps) so it is
 * unit-testable. The server is the authority for versions it has confirmed:
 * a local row that was 'synced' BEFORE the pull started, and that the server
 * no longer returns, was deleted (on another device, or by pruning there) and
 * must go here too. Everything else stays:
 *   - 'pending' rows: the server has not seen them yet, absence means nothing;
 *   - rows that turned 'synced' while the request was in flight: their POST
 *     landed after the server built its answer, so they are not in
 *     `localBeforePull` as synced and are never removed by mistake.
 *
 * Guideline 39, "Usuwanie historii".
 */
export function versionsDeletedOnServer(
  localBeforePull: ReadonlyArray<{ id: string; sync_status: 'pending' | 'synced' }>,
  serverIds: Iterable<string>
): string[] {
  const onServer = new Set(serverIds);
  return localBeforePull
    .filter((v) => v.sync_status === 'synced' && !onServer.has(v.id))
    .map((v) => v.id);
}
