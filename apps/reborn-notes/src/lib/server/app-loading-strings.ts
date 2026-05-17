// Server-side strings for the pre-boot fallback in app.html.
//
// Lives here (not in @reborn/i18n) because:
//   - hooks.server.ts injects these via transformPageChunk, before any
//     client-side JS runs. svelte-i18n is async and client-only.
//   - These strings are visible only during cold-start stall / offline-no-SW
//     fallback, so they don't flow through the normal $t() pipeline.
//
// Keep parity with the SUPPORTED_LOCALES_SERVER list in hooks.server.ts.

type AppLoadingStrings = {
  initLoading: string; // <p>Loading re/notes...</p>
  stall: string; // shown after 15s if app hasn't booted (online)
  offline: string; // shown immediately when offline + no SW, or after 15s + offline
};

const STRINGS: Record<string, AppLoadingStrings> = {
  en: {
    initLoading: 'Loading re/notes...',
    stall: 'Loading is taking longer than usual. Try refreshing the page.',
    offline: 'No network connection. Reconnect and try again.'
  },
  pl: {
    initLoading: 'Ładowanie re/notes...',
    stall: 'Ładowanie trwa dłużej niż zwykle. Spróbuj odświeżyć stronę.',
    offline: 'Brak połączenia z siecią. Połącz się i spróbuj ponownie.'
  },
  de: {
    initLoading: 're/notes wird geladen...',
    stall: 'Das Laden dauert länger als gewöhnlich. Versuche, die Seite neu zu laden.',
    offline: 'Keine Netzwerkverbindung. Verbinde dich erneut und versuche es nochmals.'
  },
  fr: {
    initLoading: 'Chargement de re/notes...',
    stall: "Le chargement prend plus de temps que d'habitude. Essayez d'actualiser la page.",
    offline: 'Pas de connexion réseau. Reconnectez-vous et réessayez.'
  },
  es: {
    initLoading: 'Cargando re/notes...',
    stall: 'La carga está tardando más de lo habitual. Intenta recargar la página.',
    offline: 'Sin conexión de red. Reconéctate e inténtalo de nuevo.'
  }
};

export function getAppLoadingStrings(locale: string): AppLoadingStrings {
  return STRINGS[locale] ?? STRINGS.en;
}
