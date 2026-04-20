import { setupI18n, t as translate, locale, changeLocale, waitLocale } from '@reborn/i18n';
import { browser } from '$app/environment';

// Initialize i18n immediately
const i18nPromise = setupI18n({
  apps: ['common', 'notes'],
  initialLocale: browser ? undefined : 'en' // Use browser locale on client, 'en' on server
});

// Export the initialization promise so components can wait for it
export const initI18n = async () => {
  await i18nPromise;
  await waitLocale();
};

// Export convenience aliases that match the expected API
export const t = translate;
export { locale, changeLocale as setLocale };
