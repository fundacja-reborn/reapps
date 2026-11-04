/**
 * Text direction (LTR / RTL) for the UI.
 *
 * The UI direction follows the UI locale: `<html dir>` is set next to
 * `<html lang>` by the server (`%dir%` in app.html, so there is no LTR flash
 * on load) and kept in sync by each app's root layout via
 * `applyDocumentLocale()`. Layout code uses logical utilities (`ms-*`,
 * `text-start`, `inset-s-*`), which follow `<html dir>` automatically.
 *
 * Note content is a separate concern: an Arabic note in an English UI (or the
 * reverse) gets its direction per line / per block from `dir="auto"`, not
 * from this module.
 *
 * Pure and dependency-free on purpose: the server imports it through the
 * `@reborn/i18n/direction` subpath (hooks.server.ts fills `%dir%`) without
 * pulling svelte-i18n and the translation bundles. The browser-side document
 * wiring lives in document-direction.ts.
 */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Languages written right-to-left (ISO 639 base subtags). A static set on
 * purpose: `Intl.Locale#getTextInfo()` / `textInfo` is not available in every
 * engine the apps support (Firefox lacks it).
 */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set([
  'ar', // Arabic
  'ckb', // Central Kurdish (Sorani)
  'dv', // Divehi
  'fa', // Persian
  'he', // Hebrew
  'ps', // Pashto
  'sd', // Sindhi
  'ug', // Uyghur
  'ur', // Urdu
  'yi' // Yiddish
]);

/**
 * Direction of a locale tag (`ar`, `ar-EG`, `he_IL`, ...). Anything that is
 * not a known RTL language - including unknown or missing values - is LTR.
 */
export function getTextDirection(locale: unknown): TextDirection {
  if (typeof locale !== 'string' || locale === '') return 'ltr';
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

export function isTextDirection(value: unknown): value is TextDirection {
  return value === 'ltr' || value === 'rtl';
}

/**
 * Physical side for a logical one: `inlineSide('end', 'ltr')` is `'right'`,
 * `inlineSide('end', 'rtl')` is `'left'`. For APIs that only take physical
 * sides - bits-ui / Floating UI `side` on tooltips, popovers and menus.
 */
export function inlineSide(side: 'start' | 'end', dir: TextDirection): 'left' | 'right' {
  return (side === 'end') === (dir === 'rtl') ? 'left' : 'right';
}
