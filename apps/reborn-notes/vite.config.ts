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
      '@reborn/i18n': resolve('../../packages/i18n/src/index.ts'),
      // jsPDF's `html()` does `await import("html2canvas")` internally. The
      // upstream package (1.4.1, last released 2022) cannot parse modern CSS
      // color functions like `oklch()` — Tailwind v4 emits oklch in :root
      // variables, and html2canvas reads computed styles across the whole
      // ancestor chain, so it fails on the very first parse. `html2canvas-pro`
      // is the maintained fork that adds oklch / lab / lch support; aliasing
      // here makes jsPDF resolve to it without modifying jsPDF source.
      html2canvas: 'html2canvas-pro'
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
    // Native (Capacitor) + CapacitorHttp: CapacitorHttp patches window.fetch, and
    // Vite's modulePreload polyfill warms cold dynamic-import chunks via that fetch
    // - so first-time lazy imports (CodeMirror code-block languages, jszip
    // export/import, periodic-dedup scan) fail with "Failed to fetch dynamically
    // imported module". Disable preloading on native: the Android System WebView
    // (Chromium) loads chunks via native import() without window.fetch. Web keeps
    // Vite's default preloading.
    modulePreload: process.env.BUILD_TARGET === 'native' ? false : undefined,
    rollupOptions: {
      external: ['@prisma/client', '.prisma/client']
    }
  }
});
