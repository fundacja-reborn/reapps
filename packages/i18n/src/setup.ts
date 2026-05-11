/**
 * Main i18n initialization and setup
 */
import { addMessages, init, locale as svelteLocale } from 'svelte-i18n';
import { get } from 'svelte/store';
import type { TranslationModule, SupportedLocale } from './config';
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getBrowserLocale,
  saveLocalePreference
} from './config';

type LocaleDictionary = Record<string, any>;

/**
 * Recursive deep merge: when both target[key] and source[key] are plain objects,
 * merge their properties at every depth. Leaves (strings, arrays, primitives)
 * are overwritten by source. Arrays are NOT merged element-wise.
 *
 * Rationale: a shallow (one-level) merge causes app-specific module files (e.g.
 * tasks/<loc>/auth.json) to silently drop nested keys defined only in the shared
 * common module — even when the app-specific override only wants to refine a
 * single leaf. Example: `auth.session.totp_*` defined in common/<loc>.json was
 * wiped out by tasks/<loc>/auth.json's minimal `session` block, leaving the
 * re-auth modal showing raw keys in Task. Deep merge lets shared keys flow
 * through while preserving per-app leaf overrides.
 */
export function mergeTranslations(target: LocaleDictionary, source: LocaleDictionary): void {
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue)
    ) {
      mergeTranslations(targetValue, sourceValue);
    } else {
      target[key] = sourceValue;
    }
  }
}

// Canonical list of modular translation files for the tasks module
const TASKS_MODULE_FILES = [
  'app',
  'auth',
  'common',
  'dashboard',
  'e2e',
  'error',
  'home',
  'menu',
  'nav',
  'network',
  'notifications',
  'pages',
  'profile',
  'search',
  'settings',
  'sync',
  'task',
  'taskList',
  'tasks',
  'unlock_e2e'
];

// Translation file manifest - list of all modular translation files
const TRANSLATION_MODULES: Record<TranslationModule, Record<SupportedLocale, string[]>> = {
  common: {
    en: [],
    pl: [],
    de: [],
    es: [],
    fr: []
  },
  tasks: {
    en: TASKS_MODULE_FILES,
    pl: TASKS_MODULE_FILES,
    de: TASKS_MODULE_FILES,
    es: TASKS_MODULE_FILES,
    fr: TASKS_MODULE_FILES
  },
  notes: {
    en: [],
    pl: [],
    de: [],
    es: [],
    fr: []
  }
};

export interface I18nOptions {
  fallbackLocale?: SupportedLocale;
  initialLocale?: SupportedLocale;
  loadingDelay?: number;
  apps: TranslationModule[];
}

/**
 * Load a single translation file
 */
async function loadTranslationFile(
  module: TranslationModule,
  locale: SupportedLocale,
  fileName: string
): Promise<any> {
  try {
    const moduleContent = await import(`./translations/${module}/${locale}/${fileName}.json`);
    return moduleContent.default || moduleContent;
  } catch (error) {
    // File doesn't exist, return empty object
    return {};
  }
}

/**
 * Load translation messages for specific modules and locale
 * This function handles both old (single file) and new (multiple files) structure
 */
async function loadTranslations(
  locale: SupportedLocale,
  modules: TranslationModule[]
): Promise<LocaleDictionary> {
  const translations: LocaleDictionary = {};

  for (const module of modules) {
    try {
      // Check if module uses new structure (has files in manifest)
      const moduleFiles = TRANSLATION_MODULES[module]?.[locale];

      if (moduleFiles && moduleFiles.length > 0) {
        // New structure: multiple files
        const mergedTranslations: LocaleDictionary = {};

        // Load all files for this module/locale
        const loadPromises = moduleFiles.map(async (fileName) => {
          const content = await loadTranslationFile(module, locale, fileName);
          return { fileName, content };
        });

        const results = await Promise.all(loadPromises);

        // Merge all file contents
        for (const { fileName, content } of results) {
          // Special handling based on filename
          if (fileName === 'app' && content.title) {
            // For app.json, we need to handle both "app" and top-level keys
            mergedTranslations['app'] = { name: content.name, description: content.description };
            mergedTranslations['appTitle'] = content.title; // Handle the appTitle that was at root
          } else {
            mergedTranslations[fileName] = content;
          }
        }

        mergeTranslations(translations, mergedTranslations);
      } else {
        // Fallback to old structure: single file
        try {
          const moduleTranslations = await import(`./translations/${module}/${locale}.json`);
          mergeTranslations(translations, moduleTranslations.default || moduleTranslations);
        } catch (error) {
          console.warn(`Failed to load translations for ${module}/${locale}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to load translations for ${module}/${locale}:`, error);
    }
  }

  return translations;
}

/**
 * Setup i18n for the application
 */
export async function setupI18n(options: I18nOptions) {
  const {
    fallbackLocale = DEFAULT_LOCALE,
    initialLocale = getBrowserLocale(),
    loadingDelay = 200,
    apps
  } = options;

  // Load translations for all supported locales and requested modules
  for (const locale of SUPPORTED_LOCALES) {
    const messages = await loadTranslations(locale, apps);
    addMessages(locale, messages);
  }

  // Initialize svelte-i18n with ICU support
  await init({
    fallbackLocale,
    initialLocale,
    loadingDelay,
    formats: {
      number: {
        EUR: { style: 'currency', currency: 'EUR' },
        USD: { style: 'currency', currency: 'USD' },
        PLN: { style: 'currency', currency: 'PLN' }
      },
      date: {
        short: {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric'
        },
        medium: {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        },
        long: {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        },
        full: {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }
      },
      time: {
        short: {
          hour: 'numeric',
          minute: 'numeric'
        },
        medium: {
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric'
        },
        long: {
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          timeZoneName: 'short'
        },
        full: {
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          timeZoneName: 'long'
        }
      }
    },
    warnOnMissingMessages: true
  });

  // Save initial locale preference only if no existing preference is stored.
  // Without this guard, a browser-detected locale (e.g. 'en' from navigator.language)
  // would overwrite the user's saved preference on every page load.
  if (typeof window !== 'undefined' && !localStorage.getItem(LOCALE_STORAGE_KEY)) {
    saveLocalePreference(initialLocale);
  }

  // Subscribe to locale changes to save preference
  svelteLocale.subscribe(($locale: string | null | undefined) => {
    if ($locale && SUPPORTED_LOCALES.includes($locale as SupportedLocale)) {
      saveLocalePreference($locale as SupportedLocale);
    }
  });
}

/**
 * Check if i18n is initialized
 */
export function isI18nInitialized(): boolean {
  try {
    // Try to get current locale - if it throws, i18n is not initialized
    const currentLocale = get(svelteLocale);
    return currentLocale !== null && currentLocale !== undefined;
  } catch {
    return false;
  }
}

/**
 * Get available locales
 */
export function getAvailableLocales(): SupportedLocale[] {
  return [...SUPPORTED_LOCALES];
}

/**
 * Change locale
 */
export async function changeLocale(newLocale: SupportedLocale): Promise<void> {
  if (!SUPPORTED_LOCALES.includes(newLocale)) {
    throw new Error(`Unsupported locale: ${newLocale}`);
  }

  svelteLocale.set(newLocale);
  saveLocalePreference(newLocale);
}

// Re-export from svelte-i18n for convenience
export { locale, locales, waitLocale, isLoading, isLoading as loading } from 'svelte-i18n';
