import { createLogger } from '@reborn/utils';
import { notesStore } from '$lib/stores/notes.store';
import { saveVersionSnapshot, saveBaselineSnapshot, discardIfEphemeral } from '$lib/services/note.service';
import { t } from '$lib/stores/i18n.store';
import { get } from 'svelte/store';
import { MAX_NOTE_CONTENT_BYTES } from '@reborn/types';

const logger = createLogger('NoteDetailService');

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'over_limit';

interface NoteEditState {
  noteId: string | null;
  title: string;
  content: string;
  folderId: string | null | undefined;
  saveStatus: SaveStatus;
  isNewNote: boolean;
}

class NoteDetailService {
  // ── Reactive state (Svelte 5 runes - used in .svelte files) ──
  title = $state('');
  content = $state('');
  folderId = $state<string | null | undefined>(undefined);
  saveStatus = $state<SaveStatus>('idle');
  isNewNote = $state(false);
  /**
   * The loaded note's ciphertext failed to decrypt (see undecryptable-rows.ts).
   * The editor buffer is left empty and every write path below is a no-op:
   * saving would overwrite the (possibly foreign-keyed) ciphertext with an
   * empty body. Normally unreachable - list rows of such notes don't open -
   * but programmatic setters of activeNoteId (nav history, deep links) funnel
   * through loadNote, so the guard lives here.
   */
  decryptFailed = $state(false);

  /** Current note size in bytes (title + content). */
  contentSize = $derived(new Blob([this.title, this.content]).size);
  /** Maximum allowed plaintext size in bytes. */
  readonly contentLimitBytes = MAX_NOTE_CONTENT_BYTES;
  /** Whether the note exceeds the per-note size limit. */
  isOverLimit = $derived(this.contentSize > MAX_NOTE_CONTENT_BYTES);

  // ── Internal tracking ──────────────────────────────────────────
  private noteId: string | null = null;

  // Separate debounce timers (title edit doesn't reset content timer)
  private titleDebounceTimer?: ReturnType<typeof setTimeout>;
  private contentDebounceTimer?: ReturnType<typeof setTimeout>;
  private readonly DEBOUNCE_MS = 2000;

  // Checkpoint timer - saves version snapshot every 30 minutes of editing
  private checkpointTimer?: ReturnType<typeof setInterval>;
  private readonly CHECKPOINT_MS = 30 * 60 * 1000; // 30 min
  private editedSinceLastSnapshot = false;
  // Whether the pristine (pre-edit) baseline of the open note has been
  // snapshotted yet this load. Reset on every loadNote, set on first edit.
  private baselineCaptured = false;

  // Pending values captured synchronously at edit time
  private pendingTitle: string | null = null;
  private pendingContent: string | null = null;

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Load a note by ID. Saves a version snapshot for the previous note,
   * resets edit state, populates title/content, and starts the checkpoint timer.
   */
  async loadNote(id: string): Promise<void> {
    // Snapshot previous note before switching (only if edited)
    const prevId = this.noteId;
    const shouldSnapshot = this.editedSinceLastSnapshot; // capture before await
    if (prevId && prevId !== id) {
      // A pristine ephemeral previous note the user never touched is discarded
      // instead of flushed+snapshotted, so an accidental New Note leaves no
      // trace (client or server). #349
      const discarded = this.isUntouchedThisLoad() && (await discardIfEphemeral(prevId));
      if (!discarded) {
        await this.flushPendingSave(prevId);
        if (shouldSnapshot) {
          await saveVersionSnapshot(prevId).catch((e) =>
            logger.error('Failed to snapshot previous note:', e)
          );
        }
      } else {
        // discardEphemeralNote removed the row from IndexedDB + noteIndex, but the
        // visible sidebar list (_raw) only re-renders on refresh - without this the
        // discarded note lingers until the next sync. #349
        notesStore.refresh();
      }
      this.editedSinceLastSnapshot = false;
    }

    this.noteId = id;
    // Fresh load: the next edit must snapshot this note's pristine state first.
    this.baselineCaptured = false;
    const note = await notesStore.loadNote(id);
    if (note) {
      this.decryptFailed = note.decrypt_failed === true;
      this.title = note.title;
      this.content = note.content;
      this.folderId = note.folder_id ?? null;
      this.saveStatus = 'idle';
      this.isNewNote = false;
    }

    // Start checkpoint timer for the new note
    this.startCheckpointTimer();
  }

  /** Re-read the currently open note from storage after pull sync; bails when the user has unsaved edits so their work wins. */
  async refreshFromStorage(): Promise<void> {
    const id = this.noteId;
    if (!id) return;
    if (this.hasPendingChanges() || this.saveStatus === 'saving') return;

    const note = await notesStore.loadNote(id);
    if (!note) return;
    // A pull can rewrite the open note into an undecryptable state (foreign
    // key epoch). Keep the in-memory plaintext - it is the best copy there is.
    if (note.decrypt_failed) return;

    if (this.title !== note.title) this.title = note.title;
    if (this.content !== note.content) this.content = note.content;
    const folderId = note.folder_id ?? null;
    if (this.folderId !== folderId) this.folderId = folderId;
  }

  /**
   * Set title with debounce. Captures value synchronously.
   */
  setTitleDebounced(title: string): void {
    if (this.decryptFailed) return;
    this.captureBaselineSnapshot();
    this.title = title;
    this.pendingTitle = title;
    this.saveStatus = 'dirty';
    this.editedSinceLastSnapshot = true;

    if (this.titleDebounceTimer) clearTimeout(this.titleDebounceTimer);
    this.titleDebounceTimer = setTimeout(() => {
      this.titleDebounceTimer = undefined;
      const captured = this.pendingTitle;
      this.pendingTitle = null;
      if (captured !== null) this.save();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Set content with debounce. Captures value synchronously.
   */
  setContentDebounced(content: string): void {
    if (this.decryptFailed) return;
    this.captureBaselineSnapshot();
    this.content = content;
    this.pendingContent = content;
    this.saveStatus = 'dirty';
    this.editedSinceLastSnapshot = true;

    if (this.contentDebounceTimer) clearTimeout(this.contentDebounceTimer);
    this.contentDebounceTimer = setTimeout(() => {
      this.contentDebounceTimer = undefined;
      const captured = this.pendingContent;
      this.pendingContent = null;
      if (captured !== null) this.save();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Restore a version (from history). Snapshots current state first,
   * then sets both title+content and saves immediately.
   */
  async restoreVersion(title: string, content: string): Promise<void> {
    // Snapshot current version before overwriting (so user doesn't lose current state)
    if (this.noteId) {
      await this.flushPendingSave();
      await saveVersionSnapshot(this.noteId).catch((e) =>
        logger.error('Failed to snapshot before restore:', e)
      );
    }

    this.title = title;
    this.content = content;
    this.pendingTitle = title;
    this.pendingContent = content;
    this.saveStatus = 'dirty';

    this.clearTimers();
    // Schedule immediate save for restored version
    this.save();
  }

  /**
   * Check if there are unsaved (dirty) changes.
   */
  hasPendingChanges(): boolean {
    return (
      this.saveStatus === 'dirty' ||
      this.pendingTitle !== null ||
      this.pendingContent !== null ||
      this.titleDebounceTimer !== undefined ||
      this.contentDebounceTimer !== undefined
    );
  }

  /**
   * Flush all pending changes immediately.
   * Uses internal noteId - never reads reactive store.
   * Returns true on success, false on failure.
   */
  async flushPendingSave(noteId?: string): Promise<boolean> {
    this.clearTimers();

    if (this.decryptFailed) return true; // nothing legitimate to write
    if (!this.hasPendingChanges() && this.saveStatus !== 'dirty') return true;

    // Block save if note exceeds size limit
    if (this.isOverLimit) {
      this.saveStatus = 'over_limit';
      logger.warn('Flush blocked: note exceeds size limit');
      return false;
    }

    const id = noteId ?? this.noteId;
    const tFn = get(t);
    const title = this.title || tFn('notes.untitled');
    const content = this.content;

    // Clear pending
    this.pendingTitle = null;
    this.pendingContent = null;

    if (!id) {
      this.saveStatus = 'idle';
      return true;
    }

    this.saveStatus = 'saving';
    try {
      await notesStore.update(id, title, content);
      this.saveStatus = 'saved';
      setTimeout(() => {
        if (this.saveStatus === 'saved') this.saveStatus = 'idle';
      }, 2000);
      return true;
    } catch (e: unknown) {
      logger.error('Failed to flush pending save:', e);
      this.saveStatus = 'dirty';
      return false;
    }
  }

  /**
   * Flush pending save + save a version snapshot.
   * Use this when the user "leaves" the note (section change, folder/tag select, navigation).
   * Skips snapshot if no edits since last snapshot (avoids duplicate versions).
   */
  async flushAndSnapshot(noteId?: string): Promise<boolean> {
    const shouldSnapshot = this.editedSinceLastSnapshot; // capture before await (reset() may clear it)
    const ok = await this.flushPendingSave(noteId);
    const id = noteId ?? this.noteId;
    if (id && shouldSnapshot) {
      await saveVersionSnapshot(id).catch((e) =>
        logger.error('Failed to save version snapshot:', e)
      );
      this.editedSinceLastSnapshot = false;
    }
    return ok;
  }

  /**
   * Leave the currently open note (note switch to null, route navigation).
   *
   * If it is a pristine ephemeral blank the user never touched, discard it with
   * zero server contact (#349) - an accidental New Note click that the user backs
   * out of leaves no trace. Otherwise flush pending edits + snapshot. Returns
   * true when handled cleanly (discarded or flushed OK), false only when a flush
   * failed (e.g. over the size limit) so the caller can keep the user on the note.
   */
  async leaveNote(noteId?: string): Promise<boolean> {
    const id = noteId ?? this.noteId;
    if (!id) return true;
    if (this.isUntouchedThisLoad() && (await discardIfEphemeral(id))) {
      this.editedSinceLastSnapshot = false;
      // Drop the discarded note from the sidebar list immediately (see loadNote). #349
      notesStore.refresh();
      return true;
    }
    return this.flushAndSnapshot(id);
  }

  /**
   * Mark this as a new note (sets viewMode hint).
   */
  setNewNote(): void {
    this.isNewNote = true;
  }

  /**
   * Reset all state. Call from cleanup effect.
   */
  reset(): void {
    this.clearTimers();
    this.stopCheckpointTimer();
    this.noteId = null;
    this.title = '';
    this.content = '';
    this.folderId = undefined;
    this.saveStatus = 'idle';
    this.isNewNote = false;
    this.decryptFailed = false;
    this.pendingTitle = null;
    this.pendingContent = null;
    this.editedSinceLastSnapshot = false;
    this.baselineCaptured = false;
  }

  /**
   * Get the internally tracked note ID (non-reactive).
   */
  getNoteId(): string | null {
    return this.noteId;
  }

  // ── Private ────────────────────────────────────────────────────

  /**
   * True when the currently-loaded note has had zero edits this load: no pending
   * debounced save, nothing edited since the last snapshot, and an empty body.
   * Gate for silently discarding a pristine ephemeral note on leave (#349).
   * Reflects this.noteId's in-memory editor state, so call it while that note is
   * still the open one (e.g. before reassigning this.noteId in loadNote).
   */
  private isUntouchedThisLoad(): boolean {
    return (
      !this.hasPendingChanges() &&
      !this.editedSinceLastSnapshot &&
      this.content.trim() === ''
    );
  }

  /**
   * Snapshot the open note's pristine (pre-edit) state the first time it's
   * edited this load. Without it, the first debounced save overwrites the
   * loaded content in IndexedDB before any snapshot runs, so version history
   * only ever captures the EDITED state and the pre-edit baseline is lost (the
   * symptom: editing a freshly-synced note makes that edit look like version 1,
   * with the original gone).
   *
   * Routes through saveBaselineSnapshot (not saveVersionSnapshot): version
   * history is lazy since #355, so the local store is empty on a cold start and
   * a blind baseline would duplicate a pre-edit state that already exists as a
   * server version. saveBaselineSnapshot pulls server history first and skips
   * when the pre-edit state is already recorded; a never-versioned note still
   * gets its baseline. Fire-and-forget; it captures the pristine entry up front.
   */
  private captureBaselineSnapshot(): void {
    if (this.baselineCaptured) return;
    const id = this.noteId;
    if (!id) return;
    this.baselineCaptured = true;
    saveBaselineSnapshot(id).catch((e) =>
      logger.error('Failed to snapshot pre-edit baseline:', e)
    );
  }

  private clearTimers(): void {
    if (this.titleDebounceTimer) {
      clearTimeout(this.titleDebounceTimer);
      this.titleDebounceTimer = undefined;
    }
    if (this.contentDebounceTimer) {
      clearTimeout(this.contentDebounceTimer);
      this.contentDebounceTimer = undefined;
    }
  }

  private startCheckpointTimer(): void {
    this.stopCheckpointTimer();
    this.checkpointTimer = setInterval(() => {
      if (this.noteId && this.editedSinceLastSnapshot) {
        this.editedSinceLastSnapshot = false;
        saveVersionSnapshot(this.noteId).catch((e) =>
          logger.error('Checkpoint snapshot failed:', e)
        );
      }
    }, this.CHECKPOINT_MS);
  }

  private stopCheckpointTimer(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = undefined;
    }
  }

  private async save(): Promise<void> {
    const id = this.noteId;
    if (!id || this.decryptFailed) return;

    // Block save if note exceeds size limit
    if (this.isOverLimit) {
      this.saveStatus = 'over_limit';
      logger.warn(`Note ${id} exceeds size limit: ${this.contentSize} / ${MAX_NOTE_CONTENT_BYTES}`);
      return;
    }

    const tFn = get(t);
    const title = this.title || tFn('notes.untitled');
    const content = this.content;

    this.saveStatus = 'saving';
    try {
      await notesStore.update(id, title, content);
      this.saveStatus = 'saved';
      setTimeout(() => {
        if (this.saveStatus === 'saved') this.saveStatus = 'idle';
      }, 2000);
    } catch (e: unknown) {
      logger.error('Failed to save note:', e);
      this.saveStatus = 'dirty';
    }
  }
}

export const noteDetailService = new NoteDetailService();
