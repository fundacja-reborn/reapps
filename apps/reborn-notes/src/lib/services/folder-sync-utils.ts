/**
 * Pure helpers for the live folder sync feature (File System Access API).
 *
 * Typed against minimal structural slices of the directory/file handle API
 * so they can be unit-tested with plain fake objects - no real File System
 * Access API (Chromium-only) needed in vitest. The real
 * `FileSystemDirectoryHandle` satisfies `DirectoryHandleLike` structurally
 * (see `$lib/types/file-system-access.d.ts`).
 */

/** Structural slice of `FileSystemFileHandle` used by the walker. */
export type FileHandleLike = {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
};

/** Structural slice of `FileSystemDirectoryHandle` used by the walker. */
export type DirectoryHandleLike = {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
};

/** One `.md` file found by the walk, path-shaped like `webkitRelativePath`. */
export type SyncFileEntry = { file: File; relativePath: string };

/**
 * Defensive depth cap for the recursive walk. The File System Access API
 * does not surface symlinks (Chromium skips them), so true cycles cannot
 * occur - this only guards against pathological real nesting.
 */
export const MAX_SYNC_DEPTH = 20;

/**
 * Recursively collect all `.md` files under `dir` as `{ file, relativePath }`
 * entries compatible with `importFolder`'s `ImportFolderInput`.
 *
 * Mirrors the folder import's pre-filters at walk time instead of
 * post-filtering: hidden entries (name starting with `.`, e.g. `.obsidian/`,
 * `.trash/`) are not descended into at all, and non-markdown files are never
 * materialized - so a re-scan touches the minimum of the directory tree.
 * The picked root itself is never treated as hidden (the user chose it).
 *
 * Paths are rooted at `dir.name` (`<root>/<sub>/<file.md>`), matching what a
 * `webkitdirectory` input produces - so the same directory imported either
 * way lands in the same folders.
 *
 * Subtrees deeper than {@link MAX_SYNC_DEPTH} are skipped and reported in
 * `skippedTooDeep` rather than silently dropped.
 */
export async function collectMarkdownEntries(
  dir: DirectoryHandleLike
): Promise<{ entries: SyncFileEntry[]; skippedTooDeep: number }> {
  const entries: SyncFileEntry[] = [];
  const counters = { skippedTooDeep: 0 };
  await walkDirectory(dir, dir.name, 0, entries, counters);
  return { entries, skippedTooDeep: counters.skippedTooDeep };
}

async function walkDirectory(
  dir: DirectoryHandleLike,
  pathPrefix: string,
  depth: number,
  out: SyncFileEntry[],
  counters: { skippedTooDeep: number }
): Promise<void> {
  if (depth > MAX_SYNC_DEPTH) {
    counters.skippedTooDeep++;
    return;
  }
  for await (const handle of dir.values()) {
    // Hidden-entry skip mirrors containsHiddenSegment(): any segment after
    // the root starting with '.' - applied to files and directories alike.
    if (handle.name.startsWith('.')) continue;
    if (handle.kind === 'directory') {
      await walkDirectory(handle, `${pathPrefix}/${handle.name}`, depth + 1, out, counters);
    } else if (handle.name.toLowerCase().endsWith('.md')) {
      const file = await handle.getFile();
      out.push({ file, relativePath: `${pathPrefix}/${handle.name}` });
    }
  }
}

/**
 * Safety margin subtracted from `lastSyncAt` when pre-filtering by mtime.
 * Covers coarse filesystem timestamp granularity (FAT: 2 s) and small clock
 * skew between the scan timestamp and file mtimes. Over-inclusion is
 * harmless: the import's unchanged-skip drops files whose content matches.
 */
export const MTIME_FILTER_MARGIN_MS = 2_000;

/**
 * Keep only entries modified since the last completed scan. With
 * `lastSyncAt = null` (first sync after linking) everything passes.
 *
 * `lastModified === 0` means "no mtime info" (same convention as
 * `pickImportTimestamps`); such files always pass so they are never starved
 * out of the import.
 */
export function filterEntriesChangedSince(
  entries: SyncFileEntry[],
  lastSyncAt: string | null
): SyncFileEntry[] {
  if (!lastSyncAt) return entries;
  const cutoff = new Date(lastSyncAt).getTime() - MTIME_FILTER_MARGIN_MS;
  if (Number.isNaN(cutoff)) return entries;
  return entries.filter((e) => e.file.lastModified === 0 || e.file.lastModified > cutoff);
}
