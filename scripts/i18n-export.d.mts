// Type declarations for i18n-export.mjs (imported by i18n-transfer.spec.ts).
import type { Catalog, Message, Messages } from './i18n-messages.mjs';

export const TRANSFER_FORMAT: 'reborn-i18n-transfer';
export const TRANSFER_VERSION: 1;

export interface KeyUsage {
  exact: Map<string, Set<string>>;
  dynamic: { prefix: string; file: string }[];
}

export interface TransferEntry {
  key: string;
  en: Message;
  where: string[];
  placeholders?: string[];
  plural?: string[];
  select?: string[];
  comment?: string;
  [locale: string]: unknown;
}

export interface TransferDocument {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  locale: string;
  exported: string;
  instructions: string[];
  strings: TransferEntry[];
}

export type CatalogReader = (catalog: Catalog, locale: string) => Messages | null;

export function scanKeyUsage(files?: string[]): KeyUsage;
export function findUsage(
  runtimeKey: string,
  usage: KeyUsage
): { files: string[]; dynamic: boolean };
export function instructions(locale: string): string[];
export function buildExport(options: {
  locale: string;
  catalogs?: string[];
  prefixes?: string[];
  only?: 'all' | 'missing';
  referenced?: boolean;
  usage?: KeyUsage;
  date?: string;
  read?: CatalogReader;
}): TransferDocument;
export function summarize(options: {
  locale: string;
  catalogs?: string[];
  read?: CatalogReader;
}): { area: string; strings: number; words: number; missing: number }[];
