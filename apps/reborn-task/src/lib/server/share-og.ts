// Server-side OG / meta strings for the public share page (/s/<slug>).
//
// Lives here (not in @reborn/i18n) because:
//   - hooks.server.ts injects these via transformPageChunk, before any
//     client-side JS runs. svelte-i18n is async and client-only.
//   - The strings are never rendered by the in-app UI, so they don't need
//     to flow through the normal $t() pipeline.
//
// Keep parity with the SUPPORTED_LOCALES_SERVER list in hooks.server.ts.

type ShareOgStrings = {
  title: string;
  description: string;
};

const STRINGS: Record<string, ShareOgStrings> = {
  en: {
    title: 'Shared task - re/task',
    description: 'End-to-end encrypted snapshot of a task shared with you.'
  },
  pl: {
    title: 'Udostępnione zadanie - re/task',
    description: 'Udostępniony dla Ciebie snapshot zadania zaszyfrowany end-to-end.'
  },
  de: {
    title: 'Geteilte Aufgabe - re/task',
    description: 'Ein Ende-zu-Ende-verschlüsselter Snapshot einer Aufgabe, der mit dir geteilt wurde.'
  },
  fr: {
    title: 'Tâche partagée - re/task',
    description: "Un instantané chiffré de bout en bout d'une tâche partagée avec vous."
  },
  es: {
    title: 'Tarea compartida - re/task',
    description: 'Una instantánea cifrada de extremo a extremo de una tarea compartida contigo.'
  }
};

export function getShareOgStrings(locale: string): ShareOgStrings {
  return STRINGS[locale] ?? STRINGS.en;
}
