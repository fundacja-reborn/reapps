/**
 * Periodic Notes service — orchestrates one-click "Today" / "This week" /
 * "This month" buttons (Obsidian Daily Notes / Periodic Notes parity).
 *
 * Stays client-side only:
 * - Folder name + note title encrypted via the shared folder/note services.
 * - Settings (folder ID, format, button visibility) live in `app-settings`
 *   IndexedDB store, NOT synced — local per-device.
 * - Cross-device behavior handled by the heuristic in `ensureFolder`: if the
 *   stored folderId is missing (deleted, or fresh device with synced folder
 *   from another machine), we look up by the locale default name in root and
 *   adopt that folder before falling back to creating a new one.
 *
 * No server schema changes. No new endpoints.
 */
import { get } from 'svelte/store';
import type { PeriodicKind } from '@reborn/storage';
import {
  PERIODIC_NOTES_DEFAULTS,
  PERIODIC_NOTES_DEFAULT_FORMATS
} from '@reborn/storage';
import { createNote } from './note.service';
import { foldersStore } from '$lib/stores/folders.store';
import { notesStore } from '$lib/stores/notes.store';
import { noteIndex } from '$lib/services/note-index.svelte';
import { getSetting } from '$lib/utils/app-settings';
import { appSettings } from '$lib/stores/app-settings.store';
import { t as i18nT, locale as i18nLocale } from '$lib/stores/i18n.store';
import { buildPeriodicTitle } from './periodic-notes-format';

export { formatName, formatRange, buildPeriodicTitle, getAnchorDate } from './periodic-notes-format';

/** Resolve i18n key synchronously from the active locale. */
function tr(key: string): string {
  return get(i18nT)(key);
}

function currentLocale(): string {
  return get(i18nLocale) || 'en';
}

/**
 * Look up the persisted folder ID for `kind`. Returns the ID if it still
 * points to an existing, non-archived folder, otherwise `null`.
 */
async function getStoredFolderId(kind: PeriodicKind): Promise<string | null> {
  const settings = await getSetting('periodicNotes');
  const folderId = settings?.[kind]?.folderId ?? null;
  if (!folderId) return null;
  const tree = get(foldersStore);
  // foldersStore.refresh() runs after every CRUD; if the stored ID is no
  // longer in the tree, treat it as gone (deleted, or user signed in on a
  // device where the folder hasn't synced yet).
  const exists = (function find(nodes: typeof tree): boolean {
    for (const n of nodes) {
      if (n.id === folderId) return true;
      if (n.children?.length && find(n.children)) return true;
    }
    return false;
  })(tree);
  return exists ? folderId : null;
}

/**
 * Persist the resolved folder ID back into app settings. Routes through the
 * `appSettings` svelte store (not raw `setSetting`) so the in-memory
 * `periodicNotesSettings` derived store sees the change immediately — without
 * this, kind detection in the editor placeholder stays stale until reload on
 * a fresh account where ensureFolder() just created the folder.
 */
async function persistFolderId(kind: PeriodicKind, folderId: string): Promise<void> {
  const current = (await getSetting('periodicNotes')) ?? PERIODIC_NOTES_DEFAULTS;
  const next = {
    ...current,
    [kind]: {
      ...current[kind],
      folderId
    }
  };
  await appSettings.update('periodicNotes', next);
}

/**
 * Find a root-level (parent_id === undefined/null) folder by exact name.
 * Used by the multi-device heuristic to adopt a folder that was created on
 * another device and synced down before settings caught up. Case-sensitive
 * because folder names are user content and we don't normalize.
 */
function findRootFolderByName(name: string): string | null {
  const tree = get(foldersStore);
  const match = tree.find((f) => f.name === name);
  return match?.id ?? null;
}

/**
 * Ensure a folder exists for `kind` and return its ID. Algorithm:
 *
 *   1. Use the folder ID from settings if it still exists.
 *   2. Otherwise, look for a root folder named like the locale default
 *      (e.g. "Daily Notes" / "Dziennik" / "Tagebuch") and adopt it — this
 *      handles fresh device + synced folder, and folder rename isn't
 *      handled here because settings store the ID, not the name.
 *   3. Otherwise, create a new root folder with the locale default name
 *      and persist its ID.
 */
export async function ensureFolder(kind: PeriodicKind): Promise<string> {
  const stored = await getStoredFolderId(kind);
  if (stored) return stored;

  const defaultName = tr(`notes.periodic.${kind}.folder.default`);

  const existing = findRootFolderByName(defaultName);
  if (existing) {
    await persistFolderId(kind, existing);
    return existing;
  }

  const newId = await foldersStore.create(defaultName);
  await persistFolderId(kind, newId);
  return newId;
}

/**
 * Find an existing periodic note by title within a specific folder. Uses the
 * in-memory note index (decrypted titles, no IndexedDB hit) — limits the search
 * scope to the configured folder per D6, so a regular note named like
 * "2026-05-08 …" outside the daily folder doesn't get hijacked.
 */
export function findExistingNote(folderId: string, title: string): string | null {
  const candidates = noteIndex
    .entries()
    .filter((e) => e.folderId === folderId && e.title === title);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  // Ambiguous (e.g. after import) — pick the most recently updated.
  let best = candidates[0];
  let bestUpdated = noteIndex.get(best.id)?.updatedAt ?? '';
  for (const c of candidates.slice(1)) {
    const u = noteIndex.get(c.id)?.updatedAt ?? '';
    if (u.localeCompare(bestUpdated) > 0) {
      best = c;
      bestUpdated = u;
    }
  }
  return best.id;
}

/**
 * One-click handler for a Periodic Notes button: ensure the kind's folder
 * exists, find or create a note for the current period, return its ID.
 *
 * `created` is true when we just made a new note (caller may want to focus
 * the title field); false when we returned an existing one.
 */
export async function getOrCreateNote(
  kind: PeriodicKind,
  now: Date = new Date()
): Promise<{ noteId: string; created: boolean }> {
  const settings = (await getSetting('periodicNotes')) ?? PERIODIC_NOTES_DEFAULTS;
  const kindCfg = settings[kind];
  const format = kindCfg.format || PERIODIC_NOTES_DEFAULT_FORMATS[kind];

  const folderId = await ensureFolder(kind);
  const title = buildPeriodicTitle(
    kind,
    now,
    format,
    PERIODIC_NOTES_DEFAULT_FORMATS[kind],
    currentLocale()
  );

  const existing = findExistingNote(folderId, title);
  if (existing) return { noteId: existing, created: false };

  const noteId = await createNote(title, '', folderId);
  // Refresh notes store so the new note appears in lists immediately.
  notesStore.refresh();
  return { noteId, created: true };
}

/** Compute the title that the button would open right now — used for tooltips. */
export function previewTitle(kind: PeriodicKind, format: string, now: Date = new Date()): string {
  return buildPeriodicTitle(
    kind,
    now,
    format,
    PERIODIC_NOTES_DEFAULT_FORMATS[kind],
    currentLocale()
  );
}
