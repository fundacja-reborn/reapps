/**
 * Svelte stores for i18n
 * Compatible with Svelte 5 runes
 */
import { derived } from 'svelte/store';
import { _ as baseTranslate, json as baseJson } from 'svelte-i18n';

/**
 * Translation function store
 * 
 * Usage in Svelte components:
 * ```svelte
 * import { t } from '@reborn/i18n';
 * 
 * <h1>{$t('welcome')}</h1>
 * <p>{$t('hello', { values: { name: 'John' } })}</p>
 * ```
 */
export const t = derived(baseTranslate, ($baseTranslate) => {
  return (key: string, options?: any) => {
    return $baseTranslate(key, options);
  };
});

/**
 * JSON store for accessing arrays and objects from translations
 * 
 * Usage:
 * ```svelte
 * import { json } from '@reborn/i18n';
 * 
 * {#each $json('menu.items') as item}
 *   <li>{item}</li>
 * {/each}
 * ```
 */
export const json = derived(baseJson, ($baseJson) => {
  return (key: string) => {
    return $baseJson(key);
  };
});

/**
 * Helper to format dates according to locale
 */
export function formatDate(date: Date | string, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, options).format(dateObj);
}

/**
 * Helper to format numbers according to locale
 */
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Helper to format currency according to locale
 */
export function formatCurrency(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(value);
}
