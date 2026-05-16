import {
  setupI18n,
  t as translate,
  locale,
  changeLocale,
  waitLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale
} from '@reborn/i18n';
import { browser } from '$app/environment';

// Public share viewer at `${base}/s/<slug>` has its own i18n rules: locale can
// be forced via `?lang=<locale>` (so authors can pin the recipient's UI to a
// specific language regardless of the recipient's browser default), and the
// resolved locale must NOT be persisted to localStorage - a guest visitor's
// browser locale must not seed `preferred_language` for the origin, otherwise
// the same browser registering an account later would inherit it as default.
function isShareViewPath(): boolean {
  if (!browser) return false;
  return /\/s\/[^/]+/.test(window.location.pathname);
}

function readLangParam(): SupportedLocale | undefined {
  if (!browser) return undefined;
  const param = new URLSearchParams(window.location.search).get('lang')?.toLowerCase();
  if (param && (SUPPORTED_LOCALES as readonly string[]).includes(param)) {
    return param as SupportedLocale;
  }
  return undefined;
}

const shareView = isShareViewPath();
const initialLocale = browser
  ? shareView
    ? readLangParam() // `?lang` overrides; undefined falls through to getBrowserLocale()
    : undefined
  : 'en';

const i18nPromise = setupI18n({
  apps: ['common', 'tasks'],
  initialLocale,
  persistPreference: !shareView
});

// Export the initialization promise so components can wait for it
export const initI18n = async () => {
  await i18nPromise;
  await waitLocale();
};

// Export convenience aliases that match the expected API
export const t = translate;
export { locale, changeLocale as setLocale };
