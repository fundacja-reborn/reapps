// Type declarations for i18n-import.mjs (imported by i18n-transfer.spec.ts).
import type { CatalogReader } from './i18n-export.mjs';
import type { Catalog, Issue, Message, Messages } from './i18n-messages.mjs';

export interface ImportResult {
  key: string;
  status: 'changed' | 'unchanged' | 'stale' | 'invalid';
  issues: Issue[];
  critical: boolean;
  comment?: string;
  en: unknown;
  text: unknown;
  previous?: Message;
}

export interface ImportPlan {
  locale: string | null;
  results: ImportResult[];
  fatal: string[];
  errors: number;
  warnings: number;
  updates: Map<string, Map<string, Message>>;
}

export function planImport(doc: unknown, options?: { read?: CatalogReader }): ImportPlan;
export function applyImport(
  plan: ImportPlan,
  options?: {
    read?: CatalogReader;
    write?: (
      catalog: Catalog,
      locale: string,
      changes: Map<string, Message>,
      order: Messages
    ) => void;
  }
): void;
export function formatReport(plan: ImportPlan, options?: { verbose?: boolean }): string;
