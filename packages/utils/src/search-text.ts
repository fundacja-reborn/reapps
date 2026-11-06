/**
 * Text matching shared by every search surface.
 *
 * Arabic is usually written without short vowels, but vocalized text (religious
 * texts, poetry, teaching material) carries them, so "كتب" has to find "كَتَبَ".
 * Search therefore ignores the Arabic marks that sit on top of a letter, and
 * the tatweel that only stretches a word. Base letters still have to match.
 *
 * Only these marks are ignored. Latin diacritics stay significant, because in
 * Polish or Spanish a letter with a diacritic is a different letter.
 */

/** Code points ignored by search, as inclusive ranges. */
const ARABIC_MARK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0610, 0x061a], // honorific and Quranic signs above letters
  [0x0640, 0x0640], // tatweel (kashida)
  [0x064b, 0x065f], // tashkeel: tanwin, harakat, shadda, sukun and extensions
  [0x0670, 0x0670], // superscript alef
  [0x06d6, 0x06dc], // Quranic annotation signs
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x08d3, 0x08e1], // Arabic Extended-A marks
  [0x08e3, 0x08ff]
];

/** The inside of a RegExp character class covering {@link ARABIC_MARK_RANGES}. */
const ARABIC_MARK_CLASS = ARABIC_MARK_RANGES.map(
  ([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`
).join('');

const ARABIC_MARKS = new RegExp(`[${ARABIC_MARK_CLASS}]`, 'g');
const ARABIC_LETTER = /\p{Script=Arabic}/u;

function stripArabicMarks(text: string): string {
  return text.replace(ARABIC_MARKS, '');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize text for a substring search: lower case, no Arabic marks. Apply it
 * to both sides of the comparison. For matching that has to report positions in
 * the original text, use {@link searchPattern}: this function changes the length.
 */
export function foldSearchText(text: string): string {
  return stripArabicMarks(text.toLowerCase());
}

/**
 * RegExp source that finds `query` literally in unmodified text, ignoring
 * Arabic marks on both sides. Matching the original text keeps the reported
 * offsets exact, and a match covers the marks of its last letter too.
 *
 * A query without Arabic letters gives a plain escaped literal. A query made of
 * marks alone has nothing left to look for and gives an empty string, which
 * the caller must treat as no match.
 */
export function searchPattern(query: string): string {
  let pattern = '';
  for (const char of stripArabicMarks(query)) {
    pattern += escapeRegExp(char);
    if (ARABIC_LETTER.test(char)) pattern += `[${ARABIC_MARK_CLASS}]*`;
  }
  return pattern;
}
