// Type declarations for i18n-messages.mjs, so the TypeScript specs in
// @reborn/i18n that import it typecheck without type-checking the plain JS.

export type Message = string | string[];
export type Messages = Map<string, Message>;
export type Syntax = 'icu' | 'plain';
export type ArgumentKind =
  | 'value'
  | 'number'
  | 'date'
  | 'time'
  | 'select'
  | 'plural'
  | 'selectordinal';

export interface Catalog {
  id: string;
  syntax: Syntax;
  path(locale: string): string;
  runtimeKey(key: string): string | null;
}

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface Problem extends Issue {
  catalog: string;
  locale: string;
  key: string;
}

export type MessageAnalysis =
  | { error: string; args?: undefined; choices?: undefined; literal?: undefined }
  | {
      error?: undefined;
      args: Map<string, ArgumentKind>;
      choices: { name: string; kind: ArgumentKind; options: string[] }[];
      literal: string;
    };

export const SOURCE_LOCALE: 'en';
export const CRITICAL_KEY_PREFIXES: string[];
export const REPO_PATHS: { REPO_ROOT: string; I18N_SRC: string; TRANSLATIONS_DIR: string };

export function listCatalogs(): Catalog[];
export function flattenMessages(obj: object, prefix?: string, out?: Messages): Messages;
export function readCatalog(catalog: Catalog, locale: string): Messages | null;
export function serializeCatalog(messages: Messages, order: Messages): string;
export function locateLeaves(text: string): Map<string, { start: number; end: number }>;
export function patchCatalogText(text: string, changes: Map<string, Message>): string | null;
export function writeCatalogChanges(
  catalog: Catalog,
  locale: string,
  changes: Map<string, Message>,
  order: Messages
): void;

export function analyzeMessage(text: string): MessageAnalysis;
export function pluralCategories(locale: string, kind?: 'plural' | 'selectordinal'): string[];
export function describeArguments(text: string): string[];
export function validateSource(text: Message, syntax?: Syntax): Issue[];
export function validateMessage(input: {
  en: Message;
  text: unknown;
  locale: string;
  syntax?: Syntax;
  mode?: 'catalog' | 'import';
}): Issue[];
export function validateCatalogs(options: {
  locales: readonly string[];
  catalogs?: Catalog[];
}): Problem[];
export function formatProblems(problems: Problem[]): string;
export function isCriticalKey(qualifiedKey: string): boolean;
