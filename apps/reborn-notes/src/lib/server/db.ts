/**
 * Re-export database client from @reborn/database package
 * This provides centralized database access across the monorepo
 */

export { prisma } from '@reborn/database';
export type { PrismaClient, Prisma } from '@reborn/database';
