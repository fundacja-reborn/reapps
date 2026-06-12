/**
 * Minimal WICG File System Access API declarations used by the live folder
 * sync feature (`folder-sync.service.ts`).
 *
 * TypeScript's bundled `DOM` lib has the FileSystemDirectoryHandle /
 * FileSystemFileHandle interfaces, but not the parts that are still WICG-only
 * (`showDirectoryPicker`, `queryPermission` / `requestPermission`) - and the
 * async directory iterator lives in `DOM.AsyncIterable`, which SvelteKit's
 * generated tsconfig does not include. Only what the feature uses is declared
 * here. Chromium is the only engine implementing the API; callers must
 * feature-detect at runtime (`isFolderSyncSupported()`).
 */
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemDirectoryHandle {
    /**
     * Iterate direct children. Declared with the concrete handle union
     * (instead of lib.dom's base `FileSystemHandle`) so walkers can narrow
     * on `kind` and reach `getFile()` without casts.
     */
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface Window {
    /** Chromium-only directory picker; requires a user gesture. */
    showDirectoryPicker(options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'home' | 'music' | 'pictures' | 'videos';
    }): Promise<FileSystemDirectoryHandle>;
  }
}
