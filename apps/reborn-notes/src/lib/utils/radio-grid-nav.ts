/**
 * Arrow-key navigation for a radio group laid out as a grid (roving tabindex:
 * only the checked item is in the tab order, arrows move AND select, as in
 * the WAI-ARIA radio group pattern).
 *
 * - Left/Right move to the previous/next item and wrap; in RTL they swap, so
 *   the arrow follows the visual direction.
 * - Up/Down move one row (`columns` items) and stop at the edges; with
 *   `columns = 1` (a wrapping row) they behave like Left/Right in LTR.
 * - Home/End jump to the first/last item.
 *
 * Returns the new index, or `null` when the key is not handled (the caller
 * then leaves the event alone).
 */
export function radioGridTarget(
  key: string,
  index: number,
  count: number,
  options: { columns: number; rtl: boolean }
): number | null {
  if (count <= 0) return null;
  const { columns, rtl } = options;
  const wrap = (i: number) => (i + count) % count;
  switch (key) {
    case 'ArrowRight':
      return wrap(index + (rtl ? -1 : 1));
    case 'ArrowLeft':
      return wrap(index + (rtl ? 1 : -1));
    case 'ArrowDown':
      if (columns <= 1) return wrap(index + 1);
      return index + columns < count ? index + columns : index;
    case 'ArrowUp':
      if (columns <= 1) return wrap(index - 1);
      return index - columns >= 0 ? index - columns : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
