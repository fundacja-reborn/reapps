import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '$lib': path.resolve('./src'),
      '$lib/*': path.resolve('./src/*')
    }
  },
  build: {
    lib: {
      entry: path.resolve('./src/index.ts'),
      name: '@reborn/ui',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        'svelte',
        'svelte/store',
        'svelte/motion',
        'svelte/transition',
        'svelte/animate',
        'svelte/easing',
        'svelte/internal',
        '@reborn/types',
        'tailwindcss',
        'bits-ui',
        'clsx',
        'lucide-svelte',
        'mode-watcher',
        'tailwind-merge',
        'tailwind-variants'
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        assetFileNames: 'assets/[name][extname]'
      }
    },
    sourcemap: true,
    emptyOutDir: true,
    outDir: 'dist'
  }
});