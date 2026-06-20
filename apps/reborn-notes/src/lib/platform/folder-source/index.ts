/**
 * Runtime selector for the FolderSource capability.
 *
 * Web is the default; the native branch (and the FolderFs plugin behind
 * `./native`) is selected only when `__REBORN_NATIVE__` is true, so the whole
 * `./native` module is dead-code-eliminated from the web bundle. Same DCE
 * pattern as `$lib/platform/index.ts`.
 */
import { createWebFolderSource } from './web';
import { createNativeFolderSource } from './native';
import type { FolderSource } from './types';

export type { FolderSource, DirectoryRef, LazyMarkdownEntry, AccessState, PickOutcome } from './types';

export const folderSource: FolderSource = __REBORN_NATIVE__
  ? createNativeFolderSource()
  : createWebFolderSource();
