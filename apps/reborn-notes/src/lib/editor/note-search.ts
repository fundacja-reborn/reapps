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
import { syntaxTree } from '@codemirror/language';
import type { SearchMatch } from '$lib/utils/note-search-core';
import { NOTE_SEARCH_MATCH_CAP } from '$lib/utils/note-search-core';
import { findTocBlockRange } from '$lib/utils/toc';
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

interface SourceRange {
  from: number;
  to: number;
}

/** What {@link NoteSearchWidgetHighlighter.collect} paints: base hits + one active. */
interface WidgetPaint {
  base: Range[];
  active: Range | null;
}

/**
 * Source ranges of the replaced block widgets currently in view - the managed
 * TOC block plus every `Table` / `FencedCode` node in the visible viewport.
 * These match exactly the blocks `decorations.ts` swaps for widgets, and let the
 * highlighter map the active source match onto a widget's DOM hit. The syntax
 * tree is walked only over `visibleRanges`, and the TOC's whole-doc regex runs
 * only when a TOC widget is actually present, to keep the per-frame scan cheap.
 */
function widgetSourceRanges(view: EditorView, hasTocRoot: boolean): SourceRange[] {
  const ranges: SourceRange[] = [];
  if (hasTocRoot) {
    const toc = findTocBlockRange(view.state.doc.toString());
    if (toc) ranges.push(toc);
  }
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Table' || node.name === 'FencedCode') {
          ranges.push({ from: node.from, to: node.to });
        }
      }
    });
  }
  return ranges;
}

/**
 * ViewPlugin that paints in-note search matches inside Live Preview block
 * widgets. It re-scans the visible widget DOM whenever the search state, the
 * document, or the viewport changes (new widgets scroll in), deferring the DOM
 * read/write to a measure pass so the widget markup is laid out. In raw editor
 * mode no widgets exist, so the scan finds nothing and the layer stays clear.
 *
 * The active match gets the strong (orange) highlight too, but only when it can
 * be located UNAMBIGUOUSLY: a widget's in-range source matches must align 1:1
 * with its DOM hits (both in document order). On any mismatch the widget falls
 * back to base-only, so a pathological query can never colour the wrong entry.
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
    view.requestMeasure<WidgetPaint>({
      key: this,
      read: () => this.collect(view),
      write: ({ base, active }) => paintWidgetHighlights(base, active)
    });
  }

  private collect(view: EditorView): WidgetPaint {
    const empty: WidgetPaint = { base: [], active: null };
    const state = view.state.field(noteSearchField, false);
    if (!state || !state.query) return empty;
    const roots = view.contentDOM.querySelectorAll<HTMLElement>(WIDGET_SELECTOR);
    if (!roots.length) return empty;

    const activeMatch = state.active >= 0 ? state.matches[state.active] : null;
    const hasTocRoot =
      !!activeMatch && Array.from(roots).some((r) => r.classList.contains('cm-lp-toc'));
    const wranges = activeMatch ? widgetSourceRanges(view, hasTocRoot) : [];

    const base: Range[] = [];
    let active: Range | null = null;
    let count = 0;

    for (const root of roots) {
      const hits = findDomMatchRanges(root, state.query, state.caseSensitive);
      if (!hits.length) continue;

      // Try to locate the active match's DOM hit inside this widget (see class
      // doc): map the root to its source range, then align in-range source
      // matches with DOM hits 1:1. Any ambiguity ⇒ this widget is base-only.
      let activeIdx = -1;
      if (activeMatch) {
        let pos = -1;
        try {
          pos = view.posAtDOM(root);
        } catch {
          pos = -1;
        }
        const wr = pos >= 0 ? wranges.find((r) => pos >= r.from && pos <= r.to) : undefined;
        if (wr && activeMatch.from >= wr.from && activeMatch.from < wr.to) {
          const inRange = state.matches.filter((m) => m.from >= wr.from && m.from < wr.to);
          if (inRange.length === hits.length) {
            activeIdx = inRange.findIndex((m) => m.from === activeMatch.from);
          }
        }
      }

      for (let i = 0; i < hits.length; i++) {
        if (i === activeIdx) active = hits[i];
        else base.push(hits[i]);
        if (++count >= NOTE_SEARCH_MATCH_CAP) return { base, active };
      }
    }
    return { base, active };
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
