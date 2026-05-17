// Server-side OG / meta strings for the public share page (/s/<slug>).
//
// Lives here (not in @reborn/i18n) because:
//   - hooks.server.ts injects these via transformPageChunk, before any
//     client-side JS runs. svelte-i18n is async and client-only.
//   - The strings are never rendered by the in-app UI, so they don't need
//     to flow through the normal $t() pipeline.
//
// Keep parity with the SUPPORTED_LOCALES_SERVER list in hooks.server.ts.
// Strings match the wording of share.view.password_intro in the matching
// notes/<locale>.json (same "End-to-end encrypted snapshot of a note ..." voice)
// so unfurl previews and the in-app gate read consistently.

type ShareOgStrings = {
  title: string;
  description: string;
};

const STRINGS: Record<string, ShareOgStrings> = {
  en: {
    title: 'Shared note - re/notes',
    description: 'End-to-end encrypted snapshot of a note shared with you.'
  },
  pl: {
    title: 'Udostępniona notatka - re/notes',
    description: 'Udostępniony dla Ciebie snapshot notatki zaszyfrowany end-to-end.'
  },
  de: {
    title: 'Geteilte Notiz - re/notes',
    description: 'Ein Ende-zu-Ende-verschlüsselter Snapshot einer Notiz, der mit dir geteilt wurde.'
  },
  fr: {
    title: 'Note partagée - re/notes',
    description: "Un instantané chiffré de bout en bout d'une note partagée avec vous."
  },
  es: {
    title: 'Nota compartida - re/notes',
    description: 'Una instantánea cifrada de extremo a extremo de una nota compartida contigo.'
  }
};

export function getShareOgStrings(locale: string): ShareOgStrings {
  return STRINGS[locale] ?? STRINGS.en;
}
