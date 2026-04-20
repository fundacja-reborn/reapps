/**
 * CM6 autocomplete extension for internal note links.
 *
 * Trigger: typing `[[` opens a completion list of note titles.
 * Selecting an item replaces `[[query` with `[Title](note:UUID)`.
 */
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion
} from '@codemirror/autocomplete';

export interface NoteLinkItem {
  id: string;
  title: string;
}

/**
 * Creates an autocomplete extension that suggests note links when user types `[[`.
 * @param getNotes — callback returning currently available notes (called on each completion request).
 * @param currentNoteId — optional id of the note being edited (excluded from suggestions).
 */
export function noteLinkAutocomplete(
  getNotes: () => NoteLinkItem[],
  currentNoteId?: string | null
) {
  function completionSource(ctx: CompletionContext): CompletionResult | null {
    // Look backwards from cursor for `[[` trigger
    const line = ctx.state.doc.lineAt(ctx.pos);
    const textBefore = line.text.slice(0, ctx.pos - line.from);

    const triggerIdx = textBefore.lastIndexOf('[[');
    if (triggerIdx === -1) return null;

    // Check there's no closing `]]` between trigger and cursor
    const afterTrigger = textBefore.slice(triggerIdx + 2);
    if (afterTrigger.includes(']]')) return null;

    const query = afterTrigger.toLowerCase();
    const from = line.from + triggerIdx; // start of `[[`

    const notes = getNotes().filter((n) => n.id !== currentNoteId);
    const filtered = query ? notes.filter((n) => n.title.toLowerCase().includes(query)) : notes;

    if (filtered.length === 0) return null;

    const options: Completion[] = filtered.map((n) => ({
      label: n.title || 'Untitled',
      detail: n.id.slice(0, 8),
      apply: (view, _completion, from, to) => {
        const insert = `[${n.title || 'Untitled'}](note:${n.id})`;
        view.dispatch({ changes: { from, to, insert } });
      }
    }));

    return { from, to: ctx.pos, options, filter: false };
  }

  return autocompletion({
    override: [completionSource],
    activateOnTyping: true,
    defaultKeymap: true
  });
}
