import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isProduction = process.env.NODE_ENV === 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: isProduction ? adapterNode() : adapterAuto(),
    // BASE_PATH controls same-origin deployment path (e.g. "/notes").
    // Empty in dev. Set PUBLIC_BASE_PATH=/notes in production env.
    //
    // `paths.relative: false` forces absolute asset URLs (`/notes/_app/...`)
    // instead of SvelteKit 2's default relative (`./_app/...`). The service
    // worker serves the cached `${base}/` shell HTML as SPA fallback for any
    // navigation under base (F5 on `/notes/notes/<id>`, `/notes/folders/<id>`,
    // `/notes/s/<slug>` etc.). With relative paths the shell's `./_app/...`
    // resolves against the current URL and 404s every chunk; absolute paths
    // work identically from every URL the shell can be served at.
    paths: {
      base: process.env.PUBLIC_BASE_PATH ?? '',
      relative: false
    },
    alias: {
      $lib: './src/lib'
    },
    csp: {
      mode: 'nonce',
      directives: {
        'default-src': ['self'],
        'script-src': ['self', 'nonce', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:', 'blob:', 'https:'],
        'font-src': ['self', 'data:'],
        'connect-src': isProduction
          ? ['self']
          : ['self', 'ws:', 'http://localhost:*', 'ws://localhost:*'],
        'frame-ancestors': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'object-src': ['none']
      }
    }
  }
};

export default config;
