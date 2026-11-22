/**
 * The phone layout of the notes view (`routes/+page.svelte`): one pane at a
 * time (list, then the note on top of it), below this width. Wider screens get
 * the list beside the editor. The one breakpoint for that switch, so the views
 * and settings that depend on it cannot drift apart.
 */
export const PHONE_LAYOUT_QUERY = '(max-width: 767px)';

/**
 * Whether the window is in the phone layout right now, or null when the
 * environment cannot tell (no `matchMedia`, e.g. outside a browser).
 */
export function matchesPhoneLayout(): boolean | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(PHONE_LAYOUT_QUERY).matches;
  } catch {
    return null;
  }
}
