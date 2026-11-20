/**
 * True for an element the on-screen keyboard opens for: a textarea, a typing
 * `<input>` (not a checkbox, button, ...) or editable content. Used by the
 * phone layouts to step floating controls aside while the user types.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'color', 'file', 'radio', 'range', 'reset', 'submit'].includes(
      target.type
    );
  }
  // `=== true`: jsdom leaves the property undefined.
  return target.isContentEditable === true;
}
