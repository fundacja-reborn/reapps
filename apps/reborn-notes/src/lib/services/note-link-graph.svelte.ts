/**
 * NoteLinkGraph - in-memory note-to-note link graph (outgoing + backlinks).
 *
 * Derives the internal-link graph (`[label](note:UUID)` references) from the
 * decrypted content of every note. Powers the "Linked notes" panel: outgoing
 * links (this note → others) and backlinks (other notes → this note).
 *
 * Security / Zero-Knowledge:
 *   - RAM-only. NEVER persisted to IndexedDB/localStorage/sessionStorage and
 *     NEVER sent to the server. A note-to-note link map is a correlation graph -
 *     exactly the metadata ZK hides (cf. the tag N-to-M design: relations live
 *     inside each note's own ciphertext, never as a server-visible join). Here
 *     the graph lives only in memory, derived from already-decrypted content,
 *     and is cleared on lock/logout.
 *   - Single source of truth is the note content itself (`content_encrypted`
 *     holds the `[label](note:UUID)` markdown). This graph is a self-healing
 *     cache: built lazily on first use (one streamed content scan, like content
 *     search - peak RAM ≈ one note), then maintained incrementally on each save.
 *
 * Lifecycle mirrors NoteIndex: invalidated by `noteIndex.build()` / `clear()`
 * (which call `noteLinkGraph.clear()`), then rebuilt lazily on next use.
 */
import { noteStore } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { extractNoteLinkTargets, intersectIds } from './note-link-utils';

const BATCH_SIZE = 100;

class NoteLinkGraph {
  /** source note id → set of target ids it links to. Non-reactive; _version signals changes. */
  private _outgoing = new Map<string, Set<string>>();
  /** target note id → set of source ids that link to it (backlinks). */
  private _incoming = new Map<string, Set<string>>();

  /** Svelte 5 reactive version counter - consumers that read links re-render on bump. */
  private _version = $state(0);
  private _building = $state(false);
  private _built = false;
  /** Generation guard - a clear() mid-build cancels the in-flight build's commit. */
  private _gen = 0;
  /** Progress of the lazy first build, so the panel can show a bar on big vaults. */
  private _progressDone = $state(0);
  private _progressTotal = $state(0);

  // ── State ───────────────────────────────────────────────────────

  /** Whether the graph has been built this session. Reactive. */
  get isBuilt(): boolean {
    void this._version;
    return this._built;
  }

  /** Whether a build() is currently running. Reactive. */
  get isBuilding(): boolean {
    return this._building;
  }

  /**
   * Progress of the in-flight build as {done, total}. `total` is 0 until the
   * note set is loaded / when idle. Reactive - drives the panel's progress bar.
   */
  get buildProgress(): { done: number; total: number } {
    return { done: this._progressDone, total: this._progressTotal };
  }

  // ── Build / maintain ────────────────────────────────────────────

  /** Build lazily - no-op if already built or a build is already in progress. */
  async ensureBuilt(): Promise<void> {
    if (this._built || this._building) return;
    await this.build();
  }

  /**
   * Full rebuild from scratch. Streams one decrypted note body at a time
   * (peak RAM ≈ one note + the edge sets), extracts link targets, and never
   * retains content. Non-blocking: processes in batches with a yield between.
   */
  async build(): Promise<void> {
    if (!cryptoManager.isInitialized()) return;
    const gen = ++this._gen;
    this._building = true;
    try {
      const all = await noteStore.getAll();
      this._progressTotal = all.length;
      this._progressDone = 0;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp, not reactive state
      const outgoing = new Map<string, Set<string>>();
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local temp, not reactive state
      const incoming = new Map<string, Set<string>>();

      for (let i = 0; i < all.length; i += BATCH_SIZE) {
        if (this._gen !== gen) return; // cancelled by clear()
        const batch = all.slice(i, i + BATCH_SIZE);
        const decrypted = await Promise.all(
          batch.map(async (enc) => ({
            id: enc.id,
            targets: extractNoteLinkTargets(await safeDecrypt(enc.content_encrypted), enc.id)
          }))
        );
        for (const { id, targets } of decrypted) {
          if (targets.size === 0) continue;
          outgoing.set(id, targets);
          for (const target of targets) {
            let sources = incoming.get(target);
            if (!sources) {
              // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Set inside non-reactive map
              sources = new Set<string>();
              incoming.set(target, sources);
            }
            sources.add(id);
          }
        }
        this._progressDone = Math.min(i + batch.length, all.length);
        await new Promise((r) => setTimeout(r, 0)); // yield to event loop
      }

      if (this._gen !== gen) return; // cancelled mid-flight
      this._outgoing = outgoing;
      this._incoming = incoming;
      this._built = true;
      this._version++;
    } finally {
      if (this._gen === gen) this._building = false;
    }
  }

  /**
   * Incremental update after a note is saved. Re-extracts the note's outgoing
   * links from its (already-plaintext) content and patches both maps in O(links).
   * No-op until the graph is built - the lazy build picks the note up later.
   */
  onNoteSaved(id: string, content: string): void {
    if (!this._built) return;
    const next = extractNoteLinkTargets(content, id);
    const prev = this._outgoing.get(id);

    // Drop backlinks for targets no longer referenced
    if (prev) {
      for (const target of prev) {
        if (!next.has(target)) this._incoming.get(target)?.delete(id);
      }
    }
    // Add backlinks for newly referenced targets
    for (const target of next) {
      if (prev?.has(target)) continue;
      let sources = this._incoming.get(target);
      if (!sources) {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Set inside non-reactive map
        sources = new Set<string>();
        this._incoming.set(target, sources);
      }
      sources.add(id);
    }

    if (next.size === 0) this._outgoing.delete(id);
    else this._outgoing.set(id, next);
    this._version++;
  }

  /** Remove a note from the graph entirely (permanent delete / empty trash). */
  onNoteRemoved(id: string): void {
    if (!this._built) return;
    // Edges where `id` is the source
    const targets = this._outgoing.get(id);
    if (targets) {
      for (const target of targets) this._incoming.get(target)?.delete(id);
      this._outgoing.delete(id);
    }
    // Edges where `id` is the target
    const sources = this._incoming.get(id);
    if (sources) {
      for (const source of sources) this._outgoing.get(source)?.delete(id);
      this._incoming.delete(id);
    }
    this._version++;
  }

  /** Wipe the graph (lock / logout / wholesale refresh). Cancels any in-flight build. */
  clear(): void {
    this._gen++; // cancel in-flight build commit
    this._outgoing = new Map();
    this._incoming = new Map();
    this._built = false;
    this._building = false;
    this._progressDone = 0;
    this._progressTotal = 0;
    this._version++;
  }

  // ── Reads ───────────────────────────────────────────────────────

  /** Note ids this note links to (outgoing). Reactive. */
  outgoingIds(id: string): string[] {
    void this._version;
    const set = this._outgoing.get(id);
    return set ? Array.from(set) : [];
  }

  /** Note ids that link to this note (backlinks / incoming). Reactive. */
  incomingIds(id: string): string[] {
    void this._version;
    const set = this._incoming.get(id);
    return set ? Array.from(set) : [];
  }

  /**
   * Ids linked in both directions - notes this note links to that also link
   * back (incoming ∩ outgoing). Reactive (via the two reads it composes).
   */
  mutualIds(id: string): Set<string> {
    return intersectIds(this.incomingIds(id), this.outgoingIds(id));
  }
}

async function safeDecrypt(stored: string): Promise<string> {
  if (!stored) return '';
  try {
    return await cryptoManager.decryptText(stored);
  } catch {
    return ''; // corrupted ciphertext - treat as no links
  }
}

export const noteLinkGraph = new NoteLinkGraph();
