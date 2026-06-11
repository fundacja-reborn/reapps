// MUST stay the very first import. Configures Zod's `jitless: true` BEFORE
// any `z.object(...)` schema is constructed in the re-exports below; if the
// order slips, the $ZodObject constructor reads `allowsEval.value` and fires
// a `new Function("")` CSP probe that browsers flag as a violation. See
// `./jitless.ts` for the rationale and the ESM-hoisting trick that makes
// this work.
import './jitless';

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
export * from './entities/saved-search';

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
  version: 12 // Bump: savedSearches store (notes)
};
