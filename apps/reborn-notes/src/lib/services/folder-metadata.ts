/**
 * Codec for a folder's `metadata_encrypted` bundle (FolderSensitiveMetadata:
 * appearance color + icon, archive marker).
 *
 * Zero Knowledge: the bundle is one AES-GCM ciphertext. AES-GCM does not hide
 * the plaintext length, and with closed sets of short keys the length alone
 * would narrow down which color/icon a folder has ("red" vs "violet",
 * "house" vs "graduation-cap") or whether it is archived. The JSON is
 * therefore padded to a fixed block (`_pad` filler, see metadata-padding.ts)
 * before encryption, sized as if the archive marker were always present, so
 * every bundle the app writes today has the same ciphertext length and the
 * server learns only that a folder has a bundle at all.
 *
 * Forward compatibility: decoding keeps every field it finds (minus the
 * filler), and updates merge into the existing bundle, so a field written by
 * a newer app version survives an edit made on an older one.
 *
 * Crypto is injected (`FolderMetadataCrypto`, satisfied by `cryptoManager`)
 * so portable backups can re-encrypt under another account's key and tests
 * need no master key.
 */
import type { FolderSensitiveMetadata } from '@reborn/types';
import { isAppearanceColor } from '$lib/utils/appearance-colors';
import { isFolderIcon } from '$lib/utils/folder-icons';
import { padBundleJson, stripPadField } from './metadata-padding';
import { ARCHIVED_AT_SIZING } from './archive-marker';

export interface FolderMetadataCrypto {
  encryptText(text: string): Promise<string>;
  decryptText(ciphertext: string): Promise<string>;
}

/** Bundle as stored: known fields plus any unknown ones from newer versions. */
export type FolderMetadataBundle = FolderSensitiveMetadata & { [field: string]: unknown };

/**
 * Padding block in UTF-8 bytes. The largest bundle the app writes today
 * (longest color and icon keys plus the archive marker) is ~100 bytes, so one
 * block holds it; a larger bundle from a newer version steps up by whole
 * blocks.
 */
export const FOLDER_METADATA_BLOCK_BYTES = 128;

/**
 * The bundle with the archive marker always counted - the size the padding is
 * computed from, so archiving or restoring a folder never moves its bundle
 * across a block boundary. Never encrypted.
 */
function sizingTwin(bundle: FolderMetadataBundle): FolderMetadataBundle {
  return {
    ...bundle,
    archived_at:
      typeof bundle.archived_at === 'string' && bundle.archived_at.length > ARCHIVED_AT_SIZING.length
        ? bundle.archived_at
        : ARCHIVED_AT_SIZING
  };
}

/** JSON of `bundle` padded to a whole number of blocks (exported for tests). */
export function padFolderMetadataJson(bundle: FolderMetadataBundle): string {
  return padBundleJson(bundle, FOLDER_METADATA_BLOCK_BYTES, sizingTwin(bundle));
}

export async function encodeFolderMetadata(
  crypto: FolderMetadataCrypto,
  bundle: FolderMetadataBundle
): Promise<string> {
  return crypto.encryptText(padFolderMetadataJson(bundle));
}

/**
 * Decrypt a bundle. `{}` when absent; `null` when present but undecryptable
 * or not a JSON object (wrong key epoch / corruption) - the caller decides
 * how to degrade.
 */
export async function decodeFolderMetadata(
  crypto: FolderMetadataCrypto,
  stored: string | null | undefined
): Promise<FolderMetadataBundle | null> {
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(await crypto.decryptText(stored));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return stripPadField(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * The appearance fields a UI may render: string values only, capped like the
 * decrypted Zod schema. Unknown keys stay as they are (the renderer falls back
 * to the default color/icon), so re-saving does not erase a newer device's
 * choice.
 */
export function readFolderAppearance(bundle: FolderMetadataBundle | null): FolderSensitiveMetadata {
  if (!bundle) return {};
  const out: FolderSensitiveMetadata = {};
  if (typeof bundle.color === 'string' && bundle.color.length <= 32) out.color = bundle.color;
  if (typeof bundle.icon === 'string' && bundle.icon.length <= 64) out.icon = bundle.icon;
  return out;
}

/**
 * Merge an appearance change into an existing bundle. `undefined` in the
 * patch removes the field (back to default); fields the patch does not name,
 * including unknown ones, are kept.
 */
export function mergeFolderAppearance(
  existing: FolderMetadataBundle,
  patch: { color?: string | undefined; icon?: string | undefined }
): FolderMetadataBundle {
  const next: FolderMetadataBundle = { ...existing };
  for (const key of ['color', 'icon'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** True when a key from the closed sets - used to reject arbitrary values at the service boundary. */
export function isValidAppearancePatch(patch: {
  color?: string | undefined;
  icon?: string | undefined;
}): boolean {
  if (patch.color !== undefined && !isAppearanceColor(patch.color)) return false;
  if (patch.icon !== undefined && !isFolderIcon(patch.icon)) return false;
  return true;
}

/**
 * Pull-time comparison of a SYNCED local row's bundle with the server's, when
 * the server version is not newer (pullFolders reconciliation, guideline 36
 * rule 9):
 * - `same`: nothing to do;
 * - `adopt`: the server has a bundle the local row lacks. Not a local edit -
 *   the row was written by a build that predates folder appearance (its pull
 *   dropped the field), or its push did not carry the field and the server
 *   upsert kept the stored bundle. Take the server's bundle;
 * - `local-edit`: the local row has a bundle the server does not (or a
 *   different one) - a push that failed silently. Re-mark pending so it retries.
 * `undefined` from the server = a server that predates the field: never a
 * difference.
 */
export function compareFolderMetadataOnPull(
  local: string | null | undefined,
  server: string | null | undefined
): 'same' | 'adopt' | 'local-edit' {
  if (server === undefined) return 'same';
  const l = local ?? null;
  const s = server ?? null;
  if (l === s) return 'same';
  if (l === null) return 'adopt';
  return 'local-edit';
}
