/**
 * Web (PWA, Chromium) FolderSource - the File System Access API.
 *
 * This is the existing live-folder-sync mechanism, extracted behind the
 * FolderSource interface unchanged: `showDirectoryPicker` for the picker,
 * `FileSystemDirectoryHandle.queryPermission/requestPermission` for the grant
 * lifecycle, `isSameEntry` for dedup, and the recursive `collectMarkdownEntries`
 * walk. The directory handle IS the `DirectoryRef`. Behaviour is byte-identical
 * to before the FolderSource refactor.
 *
 * On engines without the API (Safari/Firefox, and the native shell's WKWebView)
 * `isSupported()` is false and the feature stays hidden.
 */
import { browser } from '$app/environment';
import { createLogger } from '@reborn/utils';
import { collectMarkdownEntries } from '$lib/services/folder-sync-utils';
import type { AccessState, DirectoryRef, FolderSource, LazyMarkdownEntry, PickOutcome } from './types';

const logger = createLogger('notes:folder-source:web');

/** Picker memory key - reopens the chooser near the previously picked dir. */
const PICKER_ID = 'reborn-folder-sync';

function asHandle(ref: DirectoryRef): FileSystemDirectoryHandle {
  return ref as FileSystemDirectoryHandle;
}

export function createWebFolderSource(): FolderSource {
  return {
    isSupported(): boolean {
      return browser && typeof window.showDirectoryPicker === 'function';
    },

    dirName(ref: DirectoryRef): string {
      return asHandle(ref).name;
    },

    async pick(): Promise<PickOutcome> {
      if (!this.isSupported()) return { kind: 'unsupported' };
      try {
        const handle = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' });
        return { kind: 'picked', ref: handle, name: handle.name };
      } catch (e: unknown) {
        // AbortError = the user dismissed the picker - not an error.
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          logger.warn('showDirectoryPicker failed', e);
        }
        return { kind: 'cancelled' };
      }
    },

    async isSame(a: DirectoryRef, b: DirectoryRef): Promise<boolean> {
      try {
        return await asHandle(a).isSameEntry(asHandle(b));
      } catch (e: unknown) {
        logger.warn('isSameEntry failed', e);
        return false;
      }
    },

    async queryAccess(ref: DirectoryRef): Promise<AccessState> {
      try {
        return await asHandle(ref).queryPermission({ mode: 'read' });
      } catch (e: unknown) {
        logger.warn('queryPermission failed', e);
        return 'prompt';
      }
    },

    async requestAccess(ref: DirectoryRef): Promise<{ state: AccessState; refreshedRef?: DirectoryRef }> {
      try {
        const state = await asHandle(ref).requestPermission({ mode: 'read' });
        return { state };
      } catch (e: unknown) {
        logger.warn('requestPermission failed', e);
        return { state: 'denied' };
      }
    },

    async listMarkdown(
      ref: DirectoryRef
    ): Promise<{ entries: LazyMarkdownEntry[]; refreshedRef?: DirectoryRef; skippedTooDeep?: number }> {
      const { entries, skippedTooDeep } = await collectMarkdownEntries(asHandle(ref));
      // Adapt the eager-File walk result to lazy entries: the File is already in
      // hand (fetched for its mtime), and reading its bytes still happens only
      // when the import calls .text() - so this stays as lazy as before.
      const lazy: LazyMarkdownEntry[] = entries.map((e) => ({
        relativePath: e.relativePath,
        lastModified: e.file.lastModified,
        getFile: () => Promise.resolve(e.file)
      }));
      return { entries: lazy, skippedTooDeep };
    }
  };
}
