/**
 * CodeMirror backend for the in-note "find in note" feature.
 *
 * Two layers, both driven by a single {@link setNoteSearch} effect the host (the
 * note page) dispatches after computing matches with the shared
 * {@link findMatches}:
 *
 *  1. **Mark decorations** over editable text - the common case. Higher
 *     precedence than Live Preview's inline marks so the highlight background
 *     paints over `cm-lp-code` etc. (see NoteEditor's `Prec.highest`).
 *  2. **A widget highlighter** ({@link noteSearchWidgetPlugin}) that colours
 *     matches inside Live Preview block widgets (TOC / table / fenced code).
 *     Those widgets `Decoration.replace` their source with generated DOM, so the
 *     mark layer has no text to attach to inside them; the plugin paints their
 *     DOM via the CSS Custom Highlight API instead. The host filters out source
 *     ranges the widgets render away (e.g. TOC `#slug`s) before dispatching, so
 *     the count stays aligned with what is visible.
 *
 * Both layers are inert until the first effect, so the extension is safe to
 * include in the editor unconditionally.
 */
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  type PluginValue
} from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import type { SearchMatch } from '$lib/utils/note-search-core';
import { NOTE_SEARCH_MATCH_CAP } from '$lib/utils/note-search-core';
import {
  findDomMatchRanges,
  paintWidgetHighlights,
  clearWidgetHighlights
} from '$lib/utils/note-search-dom';

/** Current in-note search state shared by both editor layers. */
export interface NoteSearchState {
  /** Matches as document offsets (already filtered to what is visible). */
  matches: SearchMatch[];
  /** Index of the active match into {@link matches}, or -1. */
  active: number;
  /** The raw query - the widget highlighter re-searches widget DOM with it. */
  query: string;
  /** Case sensitivity, kept in sync with the query for widget re-search. */
  caseSensitive: boolean;
}

/** Effect carrying the current search state, or `null` to clear. */
export const setNoteSearch = StateEffect.define<NoteSearchState | null>();

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

/** Map a state's match offsets through a set of document changes. */
function mapState(state: NoteSearchState, changes: ViewUpdate['changes']): NoteSearchState {
  const matches: SearchMatch[] = [];
  for (const m of state.matches) {
    const from = changes.mapPos(m.from);
    const to = changes.mapPos(m.to);
    if (to > from) matches.push({ from, to });
  }
  return { ...state, matches };
}

const noteSearchField = StateField.define<NoteSearchState | null>({
  create() {
    return null;
  },
  update(state, tr) {
    // Keep highlights aligned through edits until the host recomputes, so they
    // don't visibly jump while the user types in the editor with search open.
    if (state && tr.docChanged) state = mapState(state, tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setNoteSearch)) state = effect.value;
    }
    return state;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (state) =>
      state ? buildDecorations(state.matches, state.active) : Decoration.none
    )
});

// Live Preview block widgets whose source is replaced by generated DOM. The
// mark layer can't highlight inside them; the widget highlighter searches their
// rendered text directly. (Image widgets carry no searchable text, so they are
// intentionally omitted.)
const WIDGET_SELECTOR = '.cm-lp-toc, .cm-lp-table-wrap, .cm-lp-codeblock-outer';

/**
 * ViewPlugin that paints in-note search matches inside Live Preview block
 * widgets. It re-scans the visible widget DOM whenever the search state, the
 * document, or the viewport changes (new widgets scroll in), deferring the DOM
 * read/write to a measure pass so the widget markup is laid out. In raw editor
 * mode no widgets exist, so the scan finds nothing and the layer stays clear.
 */
class NoteSearchWidgetHighlighter implements PluginValue {
  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: ViewUpdate): void {
    const searchChanged = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(setNoteSearch))
    );
    if (update.docChanged || update.viewportChanged || update.geometryChanged || searchChanged) {
      this.schedule(update.view);
    }
  }

  private schedule(view: EditorView): void {
    // `key: this` coalesces repeated requests in the same frame into one scan.
    view.requestMeasure({
      key: this,
      read: () => this.collect(view),
      write: (ranges) => paintWidgetHighlights(ranges)
    });
  }

  private collect(view: EditorView): Range[] {
    const state = view.state.field(noteSearchField, false);
    if (!state || !state.query) return [];
    const roots = view.contentDOM.querySelectorAll<HTMLElement>(WIDGET_SELECTOR);
    if (!roots.length) return [];
    const ranges: Range[] = [];
    for (const root of roots) {
      for (const range of findDomMatchRanges(root, state.query, state.caseSensitive)) {
        ranges.push(range);
        if (ranges.length >= NOTE_SEARCH_MATCH_CAP) return ranges;
      }
    }
    return ranges;
  }

  destroy(): void {
    clearWidgetHighlights();
  }
}

const noteSearchWidgetPlugin = ViewPlugin.fromClass(NoteSearchWidgetHighlighter);

/**
 * CM6 extension that renders in-note search highlights (text marks + Live
 * Preview widget highlights). Inert until the host dispatches
 * {@link setNoteSearch}; include it unconditionally in the editor.
 */
export const noteSearchExtension: Extension = [noteSearchField, noteSearchWidgetPlugin];

/** Scroll the editor so `match` is centered, without moving the caret/selection. */
export function scrollCmMatchIntoView(view: EditorView, match: SearchMatch): void {
  view.dispatch({ effects: EditorView.scrollIntoView(match.from, { y: 'center' }) });
}
