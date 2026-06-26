/**
 * CodeMirror backend for the in-note "find in note" feature.
 *
 * Renders match highlights as mark decorations driven by a single
 * {@link setNoteSearch} effect: the host (the note page) computes matches with
 * the shared {@link findMatches} and dispatches them here. The field is inert
 * until the first effect, so it is safe to include in the editor unconditionally.
 */
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import type { SearchMatch } from '$lib/utils/note-search-core';

/** Effect carrying the current match set + active index, or `null` to clear. */
export const setNoteSearch = StateEffect.define<{ matches: SearchMatch[]; active: number } | null>();

const matchDeco = Decoration.mark({ class: 'cm-note-search-match' });
const activeDeco = Decoration.mark({ class: 'cm-note-search-match cm-note-search-match-active' });

function buildDecorations(matches: SearchMatch[], active: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < matches.length; i++) {
    const { from, to } = matches[i];
    if (to <= from) continue; // mark decorations must be non-empty
    builder.add(from, to, i === active ? activeDeco : matchDeco);
  }
  return builder.finish();
}

const noteSearchField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    // Keep highlights aligned through edits until the host recomputes, so they
    // don't visibly jump while the user types in the editor with search open.
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setNoteSearch)) {
        deco = effect.value
          ? buildDecorations(effect.value.matches, effect.value.active)
          : Decoration.none;
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field)
});

/**
 * CM6 extension that renders in-note search highlights. Inert until the host
 * dispatches {@link setNoteSearch}; include it unconditionally in the editor.
 */
export const noteSearchExtension: Extension = [noteSearchField];

/** Scroll the editor so `match` is centered, without moving the caret/selection. */
export function scrollCmMatchIntoView(view: EditorView, match: SearchMatch): void {
  view.dispatch({ effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
}
