import type { LayoutLoad } from './$types';
import { initI18n } from '$lib/stores/i18n.store';

// Disable SSR for offline-first app
export const ssr = false;

export const load: LayoutLoad = async () => {
  // Initialize i18n before any component renders
  await initI18n();

  return {};
};
