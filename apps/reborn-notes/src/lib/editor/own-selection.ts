/**
 * The editor draws its own cursor and selection (CodeMirror's
 * `drawSelection`) instead of leaving them to the browser (#539).
 *
 * Why: where the text direction changes inside a line (Arabic next to a
 * number or a Latin word), one document position has two places on screen.
 * CodeMirror tracks which one is meant (the side of the position, `assoc`),
 * but a native caret is drawn by the browser from the bare offset, and each
 * engine picks the side by its own rule. Stepping into or out of such a run
 * with the arrow keys showed the caret on the far side of the run for one
 * key press. A drawn cursor is placed with `coordsAtPos(pos, assoc)`, so it
 * is always where the next character will go.
 *
 * Only where the primary pointer is fine (mouse, trackpad). The jump needs
 * arrow keys, that is a hardware keyboard. On touch screens the browser
 * places the caret itself, and its magnifier, selection handles and
 * on-screen-keyboard composition work best with the native selection, so
 * phones, tablets and the native shells keep it. An iPad with a hardware
 * keyboard reports a coarse primary pointer and keeps the native caret too.
 *
 * The selection is painted BELOW the text, so a background on editable text
 * must be translucent or it hides the selection (see `--rn-code-bg`).
 *
 * Needs `bidiLines()` in the same editor: with line wrapping on, CodeMirror
 * does not paint a selected Latin word (or number) at the edge of a row of
 * Arabic text unless `bidi-line-edge.ts` corrects where that row ends (#539).
 */
import { EditorView, drawSelection } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';

/** CodeMirror's default blink period (ms). */
const BLINK_MS = 1200;

export interface SelectionEnvironment {
  /** The primary pointer is a mouse or trackpad (`pointer: fine`). */
  finePointer: boolean;
  /** The system asks for less motion (`prefers-reduced-motion: reduce`). */
  reducedMotion: boolean;
}

/** Read the environment once, when the editor mounts. */
export function readSelectionEnvironment(): SelectionEnvironment {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { finePointer: false, reducedMotion: false };
  }
  return {
    finePointer: window.matchMedia('(pointer: fine)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };
}

// Light theme only: in the dark theme oneDark colors the drawn cursor the
// same blue its native caret had. `&light` exists only in a base theme.
// (Physical `left` on purpose: CodeMirror draws the cursor bar as a left
// border and positions it itself in either direction.)
const cursorColor = EditorView.baseTheme({
  '&light .cm-cursor': { borderLeftColor: 'var(--foreground)' }
});

// Above oneDark (`Prec.high`), which sets its own selection color with the
// same selectors. The values live in app.css, per app theme; the fallbacks
// are CodeMirror's light defaults.
const selectionColor = Prec.high(
  EditorView.theme({
    '.cm-selectionBackground': {
      background: 'var(--rn-editor-selection-blur, #d9d9d9)'
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      background: 'var(--rn-editor-selection, #d7d4f0)'
    }
  })
);

/**
 * Drawn cursor and selection where the pointer is fine, nothing elsewhere
 * (the browser's own). The blink animation is the editor's, not the system's,
 * so it is switched off when the system asks for reduced motion.
 */
export function ownSelection(env: SelectionEnvironment = readSelectionEnvironment()): Extension {
  if (!env.finePointer) return [];
  return [
    drawSelection({ cursorBlinkRate: env.reducedMotion ? 0 : BLINK_MS }),
    cursorColor,
    selectionColor
  ];
}
