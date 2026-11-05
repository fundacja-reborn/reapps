// Type declarations for i18n-review.mjs (imported by i18n-review.spec.ts).
import type { CatalogReader } from './i18n-export.mjs';
import type { Catalog, Message } from './i18n-messages.mjs';

export const REVIEW_FORMAT: 'reborn-i18n-review';
export const REVIEW_VERSION: 1;
export const REVIEW_DIR: string;
export const REVIEW_STATUSES: readonly ['reviewed', 'stale', 'edited', 'draft'];

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Hashes of the English source and of the translation at review time. */
export interface ReviewRecord {
  en: string;
  text: string;
}

export interface Review {
  locale: string;
  reviewed: Map<string, ReviewRecord>;
}

export type StatusCounts = Record<ReviewStatus, number>;

export interface ReviewReport {
  strings: { key: string; status: ReviewStatus }[];
  counts: StatusCounts;
  byCatalog: Map<string, StatusCounts>;
  orphans: string[];
  total: number;
}

export function reviewPath(locale: string, dir?: string): string;
export function hashMessage(value: Message | unknown): string;
export function trackedLocales(dir?: string): string[];
export function parseReview(text: string, locale: string): Review;
export function readReview(locale: string, dir?: string): Review | null;
export function sourceKeys(options?: { read?: CatalogReader; catalogs?: Catalog[] }): string[];
export function serializeReview(
  locale: string,
  reviewed: Map<string, ReviewRecord>,
  order: string[]
): string;
export function writeReview(
  locale: string,
  reviewed: Map<string, ReviewRecord>,
  options?: { read?: CatalogReader; dir?: string }
): { written: number; dropped: number };
export function recordReviewed(
  reviewed: Map<string, ReviewRecord>,
  items: { key: string; en: unknown; text: unknown }[]
): Map<string, ReviewRecord>;
export function stringStatus(
  record: ReviewRecord | undefined,
  en: unknown,
  text: unknown
): ReviewStatus;
export function reviewStatus(options: {
  locale: string;
  review: Pick<Review, 'reviewed'>;
  read?: CatalogReader;
  catalogs?: Catalog[];
}): ReviewReport;
export function formatCounts(counts: StatusCounts, total: number): string;
