import { z } from 'zod';

// Disable Zod's JIT-compiled validators globally. Zod v4's `allowsEval`
// feature-probe calls `new Function("")` inside try/catch to decide whether
// to compile validators via the Function constructor. Browsers report the
// caught throw as a CSP violation even though it never propagates - so under
// our strict `script-src` (no 'unsafe-eval'), every app start emits a
// `Content-Security-Policy: blocked "eval"` warning into the console.
//
// `jitless: true` skips the probe entirely; Zod falls back to interpreted
// validators. Delta is sub-millisecond for our throughput (API request
// validation via `validateBody`, IDB sync schemas) and worth the trade for
// a clean console + zero `'unsafe-eval'` in CSP.
//
// Must run BEFORE any schema validates input; configured here so every
// importer of `@reborn/types` triggers the side effect before reaching any
// `z.*Schema` export. Upstream context: zod/v4/core/util.ts:allowsEval,
// issues zod#4461 / zod#5414.
z.config({ jitless: true });

// Base types
export * from './base';
export * from './common';

// Entity types
export * from './entities/user';
export * from './entities/task';
export * from './entities/list';
export * from './entities/note';
export * from './entities/folder';
export * from './entities/tag';

// API types
export * from './api/requests';
export * from './api/responses';

// Storage types
export * from './storage';

// Shared read-only snapshot types
export * from './share';

// Database types for API compatibility
export * from './database';

// Utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Validation helpers
export * from './validation';

// Export all schemas
export * as schemas from './schemas';

/**
 * Shared IndexedDB schema version for all Reborn apps.
 *
 * Each app derives its own database name (`Reborn_task_DB`,
 * `Reborn_notes_DB`) at startup via `getDatabaseConfig(appName)` in
 * `@reborn/storage`. There is no cross-app database — see
 * `docs/architecture/zero-knowledge-architecture.md` for the rationale.
 */
export const DB_CONFIG = {
  version: 11 // Bump: per-app schema isolation, removed ghost stores
};
