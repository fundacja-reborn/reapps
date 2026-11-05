// Server-side OG / meta strings for the public share page (/s/<slug>).
//
// Lives here (not in @reborn/i18n) because:
//   - hooks.server.ts injects these via transformPageChunk, before any
//     client-side JS runs. svelte-i18n is async and client-only.
//   - The strings are never rendered by the in-app UI, so they don't need
//     to flow through the normal $t() pipeline.
//
// Typed `Record<SupportedLocale, ...>`: adding a locale to SUPPORTED_LOCALES
// (@reborn/i18n/config) fails svelte-check until its strings exist here.

import type { SupportedLocale } from '@reborn/i18n/config';

type ShareOgStrings = {
  title: string;
  description: string;
};

const STRINGS: Record<SupportedLocale, ShareOgStrings> = {
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
  },
  ar: {
    title: 'مهمة مُشارَكة - re/task',
    description: 'لقطة من مهمة، مشفّرة تمامًا بين الطرفين، تمت مشاركتها معك.'
  }
};

export function getShareOgStrings(locale: SupportedLocale): ShareOgStrings {
  return STRINGS[locale];
}
