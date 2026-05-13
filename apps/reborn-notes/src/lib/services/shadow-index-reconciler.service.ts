/**
 * Post-unlock reconciliation of note shadow indexes.
 *
 * Background: `pullNotes()` in `notes-sync.service.ts` skips re-decrypting a
 * note's metadata bundle whenever `serverVersion <= localNote.sync_version`,
 * which means any IDB record left with corrupted shadow indexes (is_pinned /
 * is_starred / tag associations defaulted to false because crypto wasn't
 * ready during an earlier pull) is locked in: subsequent pulls cannot
 * self-heal, only a full `clearAllUserData()` (logout+login) recovers.
 *
 * Phase 1 of the shadow-index unlock-race fix stops *new* corruption from
 * landing. This reconciler is Phase 2: it walks `noteStore`, re-derives
 * shadow indexes from `metadata_encrypted`, and rewrites the IDB row when
 * the decrypted state disagrees with what we have stored. Designed to be
 * called once per successful `unlockE2E()` / `reAuthenticate()` flow.
 *
 * Important: when AES-GCM rejects a row's ciphertext (wrong key, corrupted
 * IV), we deliberately leave that row untouched. Overwriting shadow indexes
 * for an undecryptable row would replace one broken state with another and
 * potentially clobber a row whose ciphertext is fine but the key is wrong.
 */
import { noteStore, noteTagOperations, noteTagQueries } from '@reborn/storage';
import type { NoteStoredLocal } from '@reborn/types';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import { extractShadowIndexes } from './shadow-index-extractor';

const logger = createLogger('Notes-ShadowReconciler');

export interface ReconcileResult {
  scanned: number;
  reconciledNotes: number;
  decryptFailed: number;
}

export async function verifyAndRebuildLocalShadowIndexes(): Promise<ReconcileResult> {
  if (!cryptoManager.isInitialized()) {
    logger.debug('Skipping reconcile - crypto manager not ready');
    return { scanned: 0, reconciledNotes: 0, decryptFailed: 0 };
  }

  const allNotes = (await noteStore.getAll()) as NoteStoredLocal[];
  let reconciledNotes = 0;
  let decryptFailed = 0;

  for (const note of allNotes) {
    if (!note.metadata_encrypted) continue;

    let is_pinned: boolean;
    let is_starred: boolean;
    let tagIds: string[];
    try {
      const shadow = await extractShadowIndexes(note.metadata_encrypted, cryptoManager);
      is_pinned = shadow.is_pinned;
      is_starred = shadow.is_starred;
      tagIds = shadow.tagIds;
    } catch (err) {
      decryptFailed++;
      logger.debug(`Decrypt failed for note ${note.id}, leaving shadow indexes untouched`, err);
      continue;
    }

    const localPinned = !!note.is_pinned;
    const localStarred = !!note.is_starred;
    const currentTagIds = await noteTagQueries.getTagsForNote(note.id);
    const toAdd = tagIds.filter((id) => !currentTagIds.includes(id));
    const toRemove = currentTagIds.filter((id) => !tagIds.includes(id));

    const pinnedDrift = localPinned !== is_pinned;
    const starredDrift = localStarred !== is_starred;
    const tagDrift = toAdd.length > 0 || toRemove.length > 0;

    if (!pinnedDrift && !starredDrift && !tagDrift) continue;

    if (pinnedDrift || starredDrift) {
      await noteStore.save({ ...note, is_pinned, is_starred });
    }
    if (tagDrift) {
      await Promise.all([
        ...toAdd.map((tagId) =>
          noteTagOperations
            .addTagToNote(note.id, tagId)
            .catch((e) => logger.warn(`Failed to add tag ${tagId} to note ${note.id}`, e))
        ),
        ...toRemove.map((tagId) =>
          noteTagOperations
            .removeTagFromNote(note.id, tagId)
            .catch((e) => logger.warn(`Failed to remove tag ${tagId} from note ${note.id}`, e))
        )
      ]);
    }
    reconciledNotes++;
  }

  if (reconciledNotes > 0) {
    logger.info(
      `Reconciled ${reconciledNotes} shadow indexes after unlock (scanned ${allNotes.length}, decrypt-failed ${decryptFailed})`
    );
  } else {
    logger.debug(
      `No shadow-index drift found (scanned ${allNotes.length}, decrypt-failed ${decryptFailed})`
    );
  }

  return { scanned: allNotes.length, reconciledNotes, decryptFailed };
}
