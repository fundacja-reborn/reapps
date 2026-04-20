/**
 * @reborn/database
 *
 * Database client and utilities for Reborn Apps
 * Uses Prisma ORM with PostgreSQL
 */

export { prisma } from './client';

// Re-export everything from Prisma generated client
export * from './generated/prisma/client';

// Explicit re-exports for items that `export *` does not forward reliably
// (namespaces / certain class re-exports depending on TS module resolution)
export { Prisma, PrismaClient } from './generated/prisma/client';

// Idempotency key helpers
export { findIdempotencyKey, storeIdempotencyResponse, cleanupExpiredKeys } from './idempotency';
