import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import tailwindcss from '@tailwindcss/vite';

const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version)
  },
  plugins: [tailwindcss(), sveltekit()],
  // Load .env from monorepo root
  envDir: '../../',
  resolve: {
    alias: {
      $lib: resolve('./src/lib'),
      '@reborn/auth/server': resolve('../../packages/auth/src/server.ts'),
      '@reborn/auth': resolve('../../packages/auth/src/index.ts'),
      '@reborn/crypto': resolve('../../packages/crypto/src/index.ts'),
      '@reborn/types': resolve('../../packages/types/src/index.ts'),
      '@reborn/utils': resolve('../../packages/utils/src/index.ts'),
      '@reborn/storage': resolve('../../packages/storage/src/index.ts'),
      '@reborn/i18n': resolve('../../packages/i18n/src/index.ts')
    }
  },
  server: {
    port: 4201,
    host: 'localhost',
    allowedHosts: ['reapps.eu'],
    // When behind nginx proxy (PUBLIC_BASE_PATH set), HMR connects directly to Vite
    // instead of going through the proxy — avoids WebSocket path mismatch
    ...(process.env.PUBLIC_BASE_PATH && {
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        clientPort: 4201
      }
    })
  },
  optimizeDeps: {
    exclude: ['@prisma/client', '.prisma/client', '@reborn/database']
  },
  ssr: {
    noExternal: process.env.NODE_ENV === 'production' ? [] : [/^@reborn\/(?!database).*/],
    external: ['@reborn/database', '@prisma/client', '.prisma/client']
  },
  build: {
    rollupOptions: {
      external: ['@prisma/client', '.prisma/client']
    }
  }
});
