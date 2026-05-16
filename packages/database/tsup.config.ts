import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: false,
  clean: true,
  external: ['@prisma/adapter-pg', 'pg', '@reborn/utils', '@reborn/types'],
  noExternal: [],
  treeshake: false,
  splitting: false,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  skipNodeModulesBundle: true,
  shims: true, // Enable shims for Node.js built-ins
  esbuildOptions(options) {
    options.platform = 'node';
    options.keepNames = true;
  },
  outExtension: () => ({ js: '.js' }),
  onSuccess: async () => {
    // Create minimal type definitions after build
    const fs = await import('fs/promises');
    const path = await import('path');

    const dtsContent = `// Auto-generated type definitions for @reborn/database
// Re-exports from the source generated prisma client (dist does not contain
// generated/ — the prisma types live only in src/, so we point at them via a
// relative path back to source).
export { prisma } from './client';
export * from '../src/generated/prisma/client';
export { Prisma, PrismaClient } from '../src/generated/prisma/client';
export { findIdempotencyKey, storeIdempotencyResponse, cleanupExpiredKeys } from '../src/idempotency';
export { cleanupExpiredShares } from '../src/share';
`;

    const clientDtsContent = `import { PrismaClient } from '../src/generated/prisma/client';
export declare const prisma: PrismaClient;
`;

    try {
      await fs.writeFile(path.join('dist', 'index.d.ts'), dtsContent);
      await fs.writeFile(path.join('dist', 'client.d.ts'), clientDtsContent);
      console.log('✅ Type definitions created successfully');
    } catch (error) {
      console.error('❌ Failed to create type definitions:', error);
    }
  }
});
