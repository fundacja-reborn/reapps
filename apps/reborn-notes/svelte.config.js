import adapterAuto from '@sveltejs/adapter-auto';
import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isProduction = process.env.NODE_ENV === 'production';

// Native (Capacitor) build target. The exact same client build, but emitted as
// a static SPA that the native shell bundles and loads from a local custom
// scheme (http://localhost on Android, capacitor://localhost on iOS). It talks
// to the remote API cross-origin. Selected via BUILD_TARGET=native; the web
// targets (adapter-node / adapter-auto) are left byte-identical when unset.
const isNative = process.env.BUILD_TARGET === 'native';

function selectAdapter() {
  if (isNative) {
    // SPA mode: a single index.html fallback + client-side routing. The native
    // shell always serves index.html as its entry point.
    //
    // strict:false - the /api/* server endpoints (+server.ts) are dead code in
    // the static bundle (the native client talks to the remote API, there is no
    // Node server in the shell). They are neither prerendered nor covered by the
    // HTML fallback, so strict mode would abort the build on them. They are
    // simply omitted from the static output.
    //
    // Output to build-native/ (not build/) so the static SPA never clobbers the
    // web adapter-node output in build/ - otherwise `cap sync` could copy a
    // Node server build into the native shell. Capacitor's webDir points here.
    return adapterStatic({
      pages: 'build-native',
      assets: 'build-native',
      fallback: 'index.html',
      strict: false
    });
  }
  return isProduction ? adapterNode() : adapterAuto();
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: selectAdapter(),
    // Native prerenders the SPA fallback; SvelteKit cannot fill `%sveltekit.nonce%`
    // in a static page, so native uses a nonce-free template variant. Web keeps the
    // nonce template (SSR fills the nonce per request for the nonce-mode CSP).
    files: {
      appTemplate: isNative ? 'src/app.native.html' : 'src/app.html'
    },
    // BASE_PATH controls same-origin deployment path (e.g. "/notes").
    // Empty in dev. Set PUBLIC_BASE_PATH=/notes in production env. Native always
    // loads from the scheme root, so base is forced empty there.
    //
    // `paths.relative: false` forces absolute asset URLs (`/notes/_app/...`)
    // instead of SvelteKit 2's default relative (`./_app/...`). The service
    // worker serves the cached `${base}/` shell HTML as SPA fallback for any
    // navigation under base (F5 on `/notes/notes/<id>`, `/notes/folders/<id>`,
    // `/notes/s/<slug>` etc.). With relative paths the shell's `./_app/...`
    // resolves against the current URL and 404s every chunk; absolute paths
    // work identically from every URL the shell can be served at. Under the
    // native scheme root this resolves to `/_app/...` against http://localhost,
    // served from the bundled assets.
    paths: {
      base: isNative ? '' : (process.env.PUBLIC_BASE_PATH ?? ''),
      relative: false
    },
    alias: {
      $lib: './src/lib'
    },
    // Web (SSR) uses per-request CSP nonces injected by SvelteKit at render
    // time. The native build is fully static - there is no server to inject a
    // nonce, and `mode: 'hash'` would nullify the `'unsafe-inline'` that Svelte
    // relies on for inline style attributes. For the Faza 0 spike we therefore
    // omit SvelteKit's CSP on native (the webview loads only locally-bundled
    // assets + the API, a narrow surface) and add a proper hash-based native CSP
    // - with the API origins in connect-src - as Faza 1 hardening.
    ...(isNative
      ? {}
      : {
          csp: {
            mode: 'nonce',
            directives: {
              'default-src': ['self'],
              // SvelteKit auto-injects `'nonce-{nonce}'` because of `mode: 'nonce'`
              // above. Do NOT include literal `'nonce'` here - it gets passed through
              // as a bare token, which browsers interpret as the hostname `https://nonce`
              // (harmless but pollutes the CSP and confuses debugging in Firefox).
              'script-src': ['self', 'wasm-unsafe-eval'],
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
        })
  }
};

export default config;
