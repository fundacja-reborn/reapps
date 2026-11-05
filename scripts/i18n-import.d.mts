// Type declarations for i18n-import.mjs (imported by i18n-transfer.spec.ts).
import type { CatalogReader } from './i18n-export.mjs';
import type { Catalog, Issue, Message, Messages } from './i18n-messages.mjs';
import type { Review, ReviewRecord } from './i18n-review.mjs';

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
  /** Entries the translator reviewed (changed or left unchanged), recorded on write. */
  reviewed: { key: string; en: Message; text: Message }[];
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
    readReviewFile?: (locale: string) => Review | null;
    writeReviewFile?: (
      locale: string,
      reviewed: Map<string, ReviewRecord>,
      options: { read: CatalogReader }
    ) => unknown;
  }
): void;
export function formatReport(plan: ImportPlan, options?: { verbose?: boolean }): string;
