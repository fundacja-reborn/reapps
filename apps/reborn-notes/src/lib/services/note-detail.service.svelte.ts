import { createLogger } from '@reborn/utils';
import { notesStore } from '$lib/stores/notes.store';
import { saveVersionSnapshot } from '$lib/services/note.service';
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
  // ── Reactive state (Svelte 5 runes — used in .svelte files) ──
  title = $state('');
  content = $state('');
  folderId = $state<string | null | undefined>(undefined);
  saveStatus = $state<SaveStatus>('idle');
  isNewNote = $state(false);

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

  // Checkpoint timer — saves version snapshot every 30 minutes of editing
  private checkpointTimer?: ReturnType<typeof setInterval>;
  private readonly CHECKPOINT_MS = 30 * 60 * 1000; // 30 min
  private editedSinceLastSnapshot = false;

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
      await this.flushPendingSave(prevId);
      if (shouldSnapshot) {
        await saveVersionSnapshot(prevId).catch((e) =>
          logger.error('Failed to snapshot previous note:', e)
        );
      }
      this.editedSinceLastSnapshot = false;
    }

    this.noteId = id;
    const note = await notesStore.loadNote(id);
    if (note) {
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

    if (this.title !== note.title) this.title = note.title;
    if (this.content !== note.content) this.content = note.content;
    const folderId = note.folder_id ?? null;
    if (this.folderId !== folderId) this.folderId = folderId;
  }

  /**
   * Set title with debounce. Captures value synchronously.
   */
  setTitleDebounced(title: string): void {
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
   * Uses internal noteId — never reads reactive store.
   * Returns true on success, false on failure.
   */
  async flushPendingSave(noteId?: string): Promise<boolean> {
    this.clearTimers();

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
    this.pendingTitle = null;
    this.pendingContent = null;
    this.editedSinceLastSnapshot = false;
  }

  /**
   * Get the internally tracked note ID (non-reactive).
   */
  getNoteId(): string | null {
    return this.noteId;
  }

  // ── Private ────────────────────────────────────────────────────

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
    if (!id) return;

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
