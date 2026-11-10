/**
 * Codec for a note's `metadata_encrypted` bundle (NoteSensitiveMetadata:
 * pinned / starred / tag ids / periodic stamp / color).
 *
 * Zero Knowledge: every write pads the JSON to whole 128-byte blocks before
 * encryption (see metadata-padding.ts). Without it the ciphertext length
 * would tell the server whether a note has a color - and which, since the
 * palette keys differ in length ("red" vs "orange") - and whether it is
 * starred or pinned (`true` vs `false`). The block count is taken from a
 * "sizing twin" with every closed-set value at its longest (color set to the
 * longest key, both flags `false`, periodic kind `monthly`), so the length
 * depends only on the number of tags (in steps of ~3 tag ids) and on whether
 * the note is a periodic one - never on its color, star or pin.
 *
 * Reading stays on `cryptoManager.decryptObject` (padded JSON is plain JSON
 * with an extra `_pad` field); writers merge into the decoded object and
 * re-encode through `encodeNoteMetadata`, which drops the stale filler.
 * Notes written before padding keep their unpadded bundle until their next
 * metadata change.
 *
 * Crypto is injected (`NoteMetadataCrypto`, satisfied by `cryptoManager`) so
 * portable backups can encode under another account's key and tests need no
 * master key.
 */
import { MAX_ENCRYPTED_NOTE_METADATA_BYTES, type NoteSensitiveMetadata } from '@reborn/types';
import { APPEARANCE_COLORS, isAppearanceColor } from '$lib/utils/appearance-colors';
import { padBundleJson, stripPadField } from './metadata-padding';

export interface NoteMetadataCrypto {
  encryptText(text: string): Promise<string>;
  decryptText(ciphertext: string): Promise<string>;
}

/** Padding block in UTF-8 bytes - the same block as folder bundles. */
export const NOTE_METADATA_BLOCK_BYTES = 128;

const LONGEST_COLOR_LENGTH = Math.max(...APPEARANCE_COLORS.map((c) => c.length));

/**
 * The bundle with every short closed-set value at its longest - the size the
 * padding is computed from (see the module comment). Never encrypted.
 */
function sizingTwin(meta: NoteSensitiveMetadata): NoteSensitiveMetadata {
  return {
    ...meta,
    is_pinned: false,
    is_starred: false,
    color: 'x'.repeat(Math.max(LONGEST_COLOR_LENGTH, meta.color?.length ?? 0)),
    periodic: meta.periodic ? { ...meta.periodic, kind: 'monthly' } : undefined
  };
}

/**
 * Encrypt a metadata bundle, padded. A bundle so large that the padded
 * ciphertext would exceed the server limit (~180+ tags on one note) falls
 * back to the unpadded JSON: those few extra bytes must not turn an
 * accepted write into a rejected one.
 */
export async function encodeNoteMetadata(
  crypto: NoteMetadataCrypto,
  meta: NoteSensitiveMetadata
): Promise<string> {
  const padded = await crypto.encryptText(
    padBundleJson(meta, NOTE_METADATA_BLOCK_BYTES, sizingTwin(meta))
  );
  if (padded.length <= MAX_ENCRYPTED_NOTE_METADATA_BYTES) return padded;
  return crypto.encryptText(JSON.stringify(stripPadField(meta as Record<string, unknown>)));
}

/**
 * Decrypt a bundle. `{}` when absent; `null` when present but undecryptable
 * or not a JSON object (wrong key epoch / corruption) - the caller decides
 * how to degrade.
 */
export async function decodeNoteMetadata(
  crypto: NoteMetadataCrypto,
  stored: string | null | undefined
): Promise<NoteSensitiveMetadata | null> {
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(await crypto.decryptText(stored));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return stripPadField(parsed as Record<string, unknown>) as NoteSensitiveMetadata;
  } catch {
    return null;
  }
}

/**
 * The color a UI may render: a string within the schema cap. An unknown key
 * (set by a newer app version) is kept - the renderer shows no mark for it,
 * and re-saving other metadata does not erase it.
 */
export function readNoteColor(meta: NoteSensitiveMetadata | null): string | undefined {
  const color = meta?.color;
  return typeof color === 'string' && color.length > 0 && color.length <= 32 ? color : undefined;
}

/** `undefined` (no color) or a key from the closed palette. */
export function isValidNoteColor(color: string | undefined): boolean {
  return color === undefined || isAppearanceColor(color);
}

/**
 * Apply a color change to a decoded bundle: `undefined` removes the field.
 * Every other field, including unknown ones from newer versions, is kept.
 */
export function withNoteColor(
  meta: NoteSensitiveMetadata,
  color: string | undefined
): NoteSensitiveMetadata {
  const next: NoteSensitiveMetadata = { ...meta };
  if (color === undefined) delete next.color;
  else next.color = color;
  return next;
}
