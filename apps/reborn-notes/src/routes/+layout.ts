import type { LayoutLoad } from './$types';
import { initI18n } from '$lib/stores/i18n.store';

// Disable SSR for offline-first app
export const ssr = false;

export const load: LayoutLoad = async () => {
  // Initialize i18n with a timeout so a slow/offline dynamic import()
  // doesn't block layout rendering indefinitely. Translations fall back
  // to message keys if this times out.
  await Promise.race([
    initI18n(),
    new Promise<void>((resolve) => setTimeout(resolve, 5000))
  ]);

  return {};
};
