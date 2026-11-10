/**
 * Length padding for encrypted JSON metadata bundles.
 *
 * Zero Knowledge: AES-GCM hides the content of a bundle but not its length.
 * When a bundle holds short keys from closed sets (a palette color, an icon
 * name, a boolean flag), the ciphertext length alone narrows down which value
 * is set ("red" vs "orange", `true` vs `false`). Padding the JSON to a whole
 * number of fixed-size blocks before encryption makes every bundle within a
 * block indistinguishable by length.
 *
 * The filler is a JSON field (`_pad`, spaces only), so the padded text is
 * still a plain JSON object: readers that predate padding parse it and ignore
 * the extra field, and a read-modify-write that carries a stale filler along
 * gets it replaced, never doubled.
 */

export const METADATA_PAD_KEY = '_pad';

/**
 * JSON of `bundle` padded to a whole number of `blockBytes` (UTF-8 bytes).
 *
 * Block padding alone still leaks near a block boundary: a few extra bytes
 * (a longer color key, `false` instead of `true`) can push one bundle into
 * the next block while its twin stays below. `sizeLike` closes that: the
 * target is the block count of `sizeLike` (the same bundle with every
 * closed-set value at its longest), so all variants of a bundle that differ
 * only in such values pad to the same length.
 */
export function padBundleJson(bundle: object, blockBytes: number, sizeLike?: object): string {
  const fields = stripPadField(bundle as Record<string, unknown>);
  const unpadded = paddedBaseBytes(fields);
  const floor = sizeLike ? paddedBaseBytes(stripPadField(sizeLike as Record<string, unknown>)) : 0;
  const target = Math.ceil(Math.max(unpadded, floor) / blockBytes) * blockBytes;
  // Spaces are 1 byte each in UTF-8 and need no JSON escaping, so the padded
  // JSON lands exactly on the target.
  return JSON.stringify({ ...fields, [METADATA_PAD_KEY]: ' '.repeat(target - unpadded) });
}

/** UTF-8 size of the bundle's JSON with an empty filler field. */
function paddedBaseBytes(fields: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify({ ...fields, [METADATA_PAD_KEY]: '' })).length;
}

/** A copy of a decoded bundle without the filler field. */
export function stripPadField<T extends Record<string, unknown>>(bundle: T): Omit<T, '_pad'> {
  const { [METADATA_PAD_KEY]: _ignored, ...fields } = bundle;
  return fields;
}
